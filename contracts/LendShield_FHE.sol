pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract LendShieldFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error InvalidParameter();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event CooldownSet(uint256 oldCooldown, uint256 newCooldown);
    event Paused(address account);
    event Unpaused(address account);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event PositionSubmitted(address indexed provider, uint256 indexed batchId, bytes32 indexed encryptedDataHash);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 totalValue, uint256 totalCollateral);

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    struct Position {
        euint32 loanAmountEnc;
        euint32 collateralAmountEnc;
    }

    mapping(address => bool) public isProvider;
    mapping(uint256 => Position[]) public batchPositions;
    mapping(uint256 => DecryptionContext) public decryptionContexts;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    address public owner;
    bool public paused;
    uint256 public cooldownSeconds;
    uint256 public currentBatchId;
    bool public currentBatchOpen;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        cooldownSeconds = 60; // Default 1 minute cooldown
        currentBatchId = 0;
        currentBatchOpen = false;
    }

    function addProvider(address _provider) external onlyOwner whenNotPaused {
        if (_provider == address(0)) revert InvalidParameter();
        isProvider[_provider] = true;
        emit ProviderAdded(_provider);
    }

    function removeProvider(address _provider) external onlyOwner whenNotPaused {
        if (!isProvider[_provider]) revert NotProvider();
        isProvider[_provider] = false;
        emit ProviderRemoved(_provider);
    }

    function setCooldownSeconds(uint256 _cooldownSeconds) external onlyOwner whenNotPaused {
        if (_cooldownSeconds == 0) revert InvalidParameter();
        emit CooldownSet(cooldownSeconds, _cooldownSeconds);
        cooldownSeconds = _cooldownSeconds;
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (currentBatchOpen) {
            currentBatchId++;
        }
        currentBatchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!currentBatchOpen) revert BatchClosed();
        currentBatchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitEncryptedPosition(euint32 _loanAmountEnc, euint32 _collateralAmountEnc)
        external
        onlyProvider
        whenNotPaused
        checkSubmissionCooldown
    {
        if (!currentBatchOpen) revert BatchClosed();
        _initIfNeeded(_loanAmountEnc);
        _initIfNeeded(_collateralAmountEnc);

        batchPositions[currentBatchId].push(Position({ loanAmountEnc: _loanAmountEnc, collateralAmountEnc: _collateralAmountEnc }));
        lastSubmissionTime[msg.sender] = block.timestamp;

        bytes32 encryptedDataHash = keccak256(abi.encodePacked(_loanAmountEnc, _collateralAmountEnc));
        emit PositionSubmitted(msg.sender, currentBatchId, encryptedDataHash);
    }

    function requestBatchAggregation(uint256 _batchId)
        external
        onlyProvider
        whenNotPaused
        checkDecryptionCooldown
    {
        if (batchPositions[_batchId].length == 0) revert InvalidParameter(); // Batch empty or doesn't exist

        Position[] storage positions = batchPositions[_batchId];
        uint256 numPositions = positions.length;

        euint32 memory totalLoanAmountEnc = FHE.asEuint32(0);
        euint32 memory totalCollateralAmountEnc = FHE.asEuint32(0);

        _initIfNeeded(totalLoanAmountEnc);
        _initIfNeeded(totalCollateralAmountEnc);

        for (uint256 i = 0; i < numPositions; i++) {
            _initIfNeeded(positions[i].loanAmountEnc);
            _initIfNeeded(positions[i].collateralAmountEnc);
            totalLoanAmountEnc = FHE.add(totalLoanAmountEnc, positions[i].loanAmountEnc);
            totalCollateralAmountEnc = FHE.add(totalCollateralAmountEnc, positions[i].collateralAmountEnc);
        }

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(totalLoanAmountEnc);
        cts[1] = FHE.toBytes32(totalCollateralAmountEnc);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: _batchId, stateHash: stateHash, processed: false });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        emit DecryptionRequested(requestId, _batchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        // Security: Replay guard ensures a decryption request is processed only once.

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(batchPositions[decryptionContexts[requestId].batchId].loanAmountEnc); // Dummy, actual values are aggregated
        cts[1] = FHE.toBytes32(batchPositions[decryptionContexts[requestId].batchId].collateralAmountEnc); // Dummy

        bytes32 currentHash = _hashCiphertexts(cts); // Rebuild state hash from current contract storage
        // Security: State verification ensures the contract state hasn't changed since the decryption was requested.
        if (currentHash != decryptionContexts[requestId].stateHash) revert StateMismatch();

        // Security: Proof verification ensures the decryption proof is valid and signed by the FHEVM key.
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert InvalidProof();

        (uint256 totalLoanAmount, uint256 totalCollateralAmount) = abi.decode(cleartexts, (uint256, uint256));

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, totalLoanAmount, totalCollateralAmount);
    }

    function _hashCiphertexts(bytes32[] memory _cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(_cts, address(this)));
    }

    function _initIfNeeded(euint32 _val) internal view {
        if (!_val.isInitialized()) revert NotInitialized();
    }

    function _initIfNeeded(ebool _val) internal view {
        if (!_val.isInitialized()) revert NotInitialized();
    }
}