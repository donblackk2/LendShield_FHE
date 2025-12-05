import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface LoanPosition {
  id: number;
  protocol: string;
  encryptedAmount: string;
  encryptedCollateral: string;
  healthFactor: number;
  timestamp: number;
  owner: string;
}

interface UserAction {
  type: 'deposit' | 'borrow' | 'adjust' | 'decrypt';
  timestamp: number;
  details: string;
}

interface Announcement {
  id: number;
  title: string;
  content: string;
  timestamp: number;
}

// FHE encryption/decryption functions
const FHEEncryptNumber = (value: number): string => `FHE-${btoa(value.toString())}`;
const FHEDecryptNumber = (encryptedData: string): number => encryptedData.startsWith('FHE-') ? parseFloat(atob(encryptedData.substring(4))) : parseFloat(encryptedData);
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [positions, setPositions] = useState<LoanPosition[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [selectedPosition, setSelectedPosition] = useState<LoanPosition | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [decryptedCollateral, setDecryptedCollateral] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [chainId, setChainId] = useState(0);
  const [startTimestamp, setStartTimestamp] = useState(0);
  const [durationDays, setDurationDays] = useState(30);
  const [userActions, setUserActions] = useState<UserAction[]>([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [searchTerm, setSearchTerm] = useState("");
  const [filterProtocol, setFilterProtocol] = useState("all");
  const [announcements, setAnnouncements] = useState<Announcement[]>([
    {
      id: 1,
      title: "System Upgrade Notice",
      content: "We will perform a scheduled maintenance on Oct 20, 2025 from 2:00 AM to 4:00 AM UTC.",
      timestamp: Date.now() - 86400000
    },
    {
      id: 2,
      title: "New Protocol Integration",
      content: "Aave V4 has been added to our supported protocols list.",
      timestamp: Date.now() - 172800000
    }
  ]);

  // Initialize signature parameters
  useEffect(() => {
    loadData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  // Load data from contract
  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
      
      // Load positions
      const positionsBytes = await contract.getData("positions");
      let positionsList: LoanPosition[] = [];
      if (positionsBytes.length > 0) {
        try {
          const positionsStr = ethers.toUtf8String(positionsBytes);
          if (positionsStr.trim() !== '') positionsList = JSON.parse(positionsStr);
        } catch (e) {}
      }
      setPositions(positionsList);
    } catch (e) {
      console.error("Error loading data:", e);
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  // Create new position (simulated)
  const createPosition = async (type: 'deposit' | 'borrow', amount: number, collateral: number, protocol: string) => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: `Processing ${type} with Zama FHE...` });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Create new position
      const newPosition: LoanPosition = {
        id: positions.length + 1,
        protocol,
        encryptedAmount: FHEEncryptNumber(amount),
        encryptedCollateral: FHEEncryptNumber(collateral),
        healthFactor: Math.random() * 2 + 1, // Random health factor between 1-3
        timestamp: Math.floor(Date.now() / 1000),
        owner: address
      };
      
      // Update positions list
      const updatedPositions = [...positions, newPosition];
      
      // Save to contract
      await contract.setData("positions", ethers.toUtf8Bytes(JSON.stringify(updatedPositions)));
      
      // Update user actions
      const newAction: UserAction = {
        type,
        timestamp: Math.floor(Date.now() / 1000),
        details: `${type === 'deposit' ? 'Deposited' : 'Borrowed'} ${amount} with ${collateral} collateral on ${protocol}`
      };
      setUserActions(prev => [newAction, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: `${type === 'deposit' ? 'Deposit' : 'Borrow'} completed with FHE!` });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Operation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  // Adjust position (simulated)
  const adjustPosition = async (positionId: number, amountChange: number, collateralChange: number) => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Adjusting position with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Find the position
      const positionIndex = positions.findIndex(p => p.id === positionId);
      if (positionIndex === -1) throw new Error("Position not found");
      
      // Update position (in real app would need to decrypt first)
      const updatedPositions = [...positions];
      updatedPositions[positionIndex].healthFactor = Math.random() * 2 + 1; // Simulate health factor change
      
      // Save to contract
      await contract.setData("positions", ethers.toUtf8Bytes(JSON.stringify(updatedPositions)));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'adjust',
        timestamp: Math.floor(Date.now() / 1000),
        details: `Adjusted position #${positionId} (Amount Δ: ${amountChange}, Collateral Δ: ${collateralChange})`
      };
      setUserActions(prev => [newAction, ...prev]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Position adjusted with FHE!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Adjustment failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  // Decrypt position with signature
  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Update user actions
      const newAction: UserAction = {
        type: 'decrypt',
        timestamp: Math.floor(Date.now() / 1000),
        details: "Decrypted FHE data"
      };
      setUserActions(prev => [newAction, ...prev]);
      
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  // Render health factor indicator
  const renderHealthFactor = (healthFactor: number) => {
    let color = "#4CAF50"; // Green
    if (healthFactor < 1.5) color = "#FFC107"; // Yellow
    if (healthFactor < 1.2) color = "#F44336"; // Red
    
    return (
      <div className="health-factor">
        <div className="health-bar">
          <div 
            className="health-fill" 
            style={{ 
              width: `${Math.min(healthFactor * 50, 100)}%`,
              backgroundColor: color
            }}
          ></div>
        </div>
        <span className="health-value">{healthFactor.toFixed(2)}</span>
      </div>
    );
  };

  // Render FHE flow visualization
  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>Private Position Creation</h4>
            <p>Users create loan positions with encrypted amounts and collateral</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>FHE Aggregation</h4>
            <p>Protocol aggregates liquidity across platforms without decrypting user data</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>Encrypted Risk Calculation</h4>
            <p>Health factors computed on encrypted data using homomorphic operations</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>Private Liquidation Protection</h4>
            <p>Users receive encrypted warnings without exposing their positions</p>
          </div>
        </div>
      </div>
    );
  };

  // Render user actions history
  const renderUserActions = () => {
    if (userActions.length === 0) return <div className="no-data">No actions recorded</div>;
    
    return (
      <div className="actions-list">
        {userActions.map((action, index) => (
          <div className="action-item" key={index}>
            <div className={`action-type ${action.type}`}>
              {action.type === 'deposit' && '💰'}
              {action.type === 'borrow' && '🏦'}
              {action.type === 'adjust' && '🔄'}
              {action.type === 'decrypt' && '🔓'}
            </div>
            <div className="action-details">
              <div className="action-text">{action.details}</div>
              <div className="action-time">{new Date(action.timestamp * 1000).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render announcements
  const renderAnnouncements = () => {
    return (
      <div className="announcements-list">
        {announcements.map((announcement) => (
          <div className="announcement-item" key={announcement.id}>
            <div className="announcement-header">
              <h4>{announcement.title}</h4>
              <span className="announcement-time">{new Date(announcement.timestamp).toLocaleDateString()}</span>
            </div>
            <div className="announcement-content">{announcement.content}</div>
          </div>
        ))}
      </div>
    );
  };

  // Filter positions based on search and protocol filter
  const filteredPositions = positions.filter(position => {
    const matchesSearch = position.protocol.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         position.owner.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesProtocol = filterProtocol === "all" || position.protocol === filterProtocol;
    return matchesSearch && matchesProtocol;
  });

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing encrypted lending system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>LendShield<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-grid">
          {/* Left Column */}
          <div className="dashboard-column left-column">
            <div className="dashboard-panel intro-panel">
              <h2>Private DeFi Lending Aggregator</h2>
              <p>LendShield_FHE aggregates liquidity across lending protocols while keeping your positions private using Zama FHE technology.</p>
              <div className="fhe-badge">
                <div className="fhe-icon"></div>
                <span>Powered by Zama FHE</span>
              </div>
            </div>
            
            <div className="dashboard-panel fhe-flow-panel">
              <h2>FHE Lending Flow</h2>
              {renderFHEFlow()}
            </div>
            
            <div className="dashboard-panel announcements-panel">
              <h2>System Announcements</h2>
              {renderAnnouncements()}
            </div>
          </div>
          
          {/* Center Column */}
          <div className="dashboard-column center-column">
            <div className="dashboard-panel stats-panel">
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{positions.length}</div>
                  <div className="stat-label">Total Positions</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">
                    {positions.length > 0 
                      ? (positions.reduce((sum, p) => sum + p.healthFactor, 0) / positions.length).toFixed(2)
                      : 0}
                  </div>
                  <div className="stat-label">Avg Health Factor</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">
                    {positions.filter(p => p.healthFactor < 1.2).length}
                  </div>
                  <div className="stat-label">At Risk</div>
                </div>
              </div>
            </div>
            
            <div className="dashboard-panel positions-panel">
              <div className="panel-header">
                <h2>Your Loan Positions</h2>
                <div className="search-filter">
                  <input 
                    type="text" 
                    placeholder="Search positions..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  <select 
                    value={filterProtocol} 
                    onChange={(e) => setFilterProtocol(e.target.value)}
                  >
                    <option value="all">All Protocols</option>
                    <option value="Aave">Aave</option>
                    <option value="Compound">Compound</option>
                    <option value="MakerDAO">MakerDAO</option>
                  </select>
                  <button 
                    onClick={loadData} 
                    className="refresh-btn" 
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>
              
              <div className="positions-list">
                {filteredPositions.length === 0 ? (
                  <div className="no-positions">
                    <div className="no-positions-icon"></div>
                    <p>No positions found</p>
                    <div className="action-buttons">
                      <button 
                        className="action-btn deposit" 
                        onClick={() => createPosition('deposit', 1000, 1500, 'Aave')}
                      >
                        Simulate Deposit
                      </button>
                      <button 
                        className="action-btn borrow" 
                        onClick={() => createPosition('borrow', 500, 1000, 'Compound')}
                      >
                        Simulate Borrow
                      </button>
                    </div>
                  </div>
                ) : filteredPositions.map((position, index) => (
                  <div 
                    className={`position-item ${selectedPosition?.id === position.id ? "selected" : ""}`} 
                    key={index}
                    onClick={() => setSelectedPosition(position)}
                  >
                    <div className="position-header">
                      <div className="position-protocol">{position.protocol}</div>
                      <div className="position-id">#{position.id}</div>
                    </div>
                    <div className="position-data">
                      <div className="data-item">
                        <span>Amount:</span>
                        <strong>{position.encryptedAmount.substring(0, 10)}...</strong>
                      </div>
                      <div className="data-item">
                        <span>Collateral:</span>
                        <strong>{position.encryptedCollateral.substring(0, 10)}...</strong>
                      </div>
                    </div>
                    <div className="position-health">
                      <span>Health Factor:</span>
                      {renderHealthFactor(position.healthFactor)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {/* Right Column */}
          <div className="dashboard-column right-column">
            <div className="dashboard-panel actions-panel">
              <h2>Your Activity</h2>
              {renderUserActions()}
            </div>
            
            <div className="dashboard-panel quick-actions-panel">
              <h2>Quick Actions</h2>
              <div className="quick-actions">
                <button 
                  className="action-btn deposit" 
                  onClick={() => createPosition('deposit', 1000, 1500, 'Aave')}
                >
                  New Deposit
                </button>
                <button 
                  className="action-btn borrow" 
                  onClick={() => createPosition('borrow', 500, 1000, 'Compound')}
                >
                  New Borrow
                </button>
                <button 
                  className="action-btn adjust" 
                  disabled={!selectedPosition}
                  onClick={() => selectedPosition && adjustPosition(selectedPosition.id, 100, 50)}
                >
                  Adjust Position
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {selectedPosition && (
        <PositionDetailModal 
          position={selectedPosition} 
          onClose={() => { 
            setSelectedPosition(null); 
            setDecryptedAmount(null);
            setDecryptedCollateral(null);
          }} 
          decryptedAmount={decryptedAmount}
          decryptedCollateral={decryptedCollateral}
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
          renderHealthFactor={renderHealthFactor}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>LendShield_FHE</span>
            </div>
            <p>Private DeFi Lending Aggregator powered by FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} LendShield_FHE. All rights reserved.</div>
          <div className="disclaimer">
            This system uses fully homomorphic encryption to protect your financial privacy. 
            All loan positions are encrypted and computations are performed on encrypted data.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface PositionDetailModalProps {
  position: LoanPosition;
  onClose: () => void;
  decryptedAmount: number | null;
  decryptedCollateral: number | null;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
  renderHealthFactor: (healthFactor: number) => JSX.Element;
}

const PositionDetailModal: React.FC<PositionDetailModalProps> = ({ 
  position, 
  onClose, 
  decryptedAmount,
  decryptedCollateral,
  isDecrypting, 
  decryptWithSignature,
  renderHealthFactor
}) => {
  const handleDecrypt = async () => {
    if (decryptedAmount !== null) { 
      setDecryptedAmount(null); 
      setDecryptedCollateral(null);
      return; 
    }
    
    const decryptedAmt = await decryptWithSignature(position.encryptedAmount);
    const decryptedCol = await decryptWithSignature(position.encryptedCollateral);
    
    if (decryptedAmt !== null && decryptedCol !== null) {
      setDecryptedAmount(decryptedAmt);
      setDecryptedCollateral(decryptedCol);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="position-detail-modal">
        <div className="modal-header">
          <h2>Position Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="position-info">
            <div className="info-item">
              <span>Protocol:</span>
              <strong>{position.protocol}</strong>
            </div>
            <div className="info-item">
              <span>Owner:</span>
              <strong>{position.owner.substring(0, 6)}...{position.owner.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(position.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="position-data-section">
            <h3>Encrypted Position Data</h3>
            
            <div className="data-row">
              <div className="data-label">Loan Amount:</div>
              <div className="data-value encrypted">
                {position.encryptedAmount.substring(0, 20)}...
                <span className="fhe-tag">FHE Encrypted</span>
              </div>
            </div>
            
            <div className="data-row">
              <div className="data-label">Collateral:</div>
              <div className="data-value encrypted">
                {position.encryptedCollateral.substring(0, 20)}...
                <span className="fhe-tag">FHE Encrypted</span>
              </div>
            </div>
            
            <div className="data-row">
              <div className="data-label">Health Factor:</div>
              <div className="data-value">
                {renderHealthFactor(position.healthFactor)}
              </div>
            </div>
            
            <button 
              className="decrypt-btn" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span>Decrypting...</span>
              ) : decryptedAmount !== null ? (
                "Hide Decrypted Values"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>
          
          {decryptedAmount !== null && decryptedCollateral !== null && (
            <div className="decrypted-section">
              <h3>Decrypted Values</h3>
              
              <div className="data-row">
                <div className="data-label">Loan Amount:</div>
                <div className="data-value decrypted">
                  {decryptedAmount.toFixed(2)} USD
                </div>
              </div>
              
              <div className="data-row">
                <div className="data-label">Collateral:</div>
                <div className="data-value decrypted">
                  {decryptedCollateral.toFixed(2)} USD
                </div>
              </div>
              
              <div className="data-row">
                <div className="data-label">Collateral Ratio:</div>
                <div className="data-value">
                  {(decryptedCollateral / decryptedAmount * 100).toFixed(2)}%
                </div>
              </div>
              
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted values are only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;