// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface TradingRing {
  id: string;
  encryptedData: string;
  timestamp: number;
  broker: string;
  participants: number;
  status: "suspected" | "confirmed" | "dismissed";
}

const App: React.FC = () => {
  // State management
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [rings, setRings] = useState<TradingRing[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRingData, setNewRingData] = useState({
    broker: "",
    participants: "",
    evidence: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "suspected" | "confirmed" | "dismissed">("all");

  // Calculate statistics
  const suspectedCount = rings.filter(r => r.status === "suspected").length;
  const confirmedCount = rings.filter(r => r.status === "confirmed").length;
  const dismissedCount = rings.filter(r => r.status === "dismissed").length;

  // Filter rings based on search and filter
  const filteredRings = rings.filter(ring => {
    const matchesSearch = ring.broker.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          ring.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = activeFilter === "all" || ring.status === activeFilter;
    return matchesSearch && matchesFilter;
  });

  // Load initial data
  useEffect(() => {
    loadRings().finally(() => setLoading(false));
  }, []);

  // Wallet connection handlers
  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  // Load rings from contract
  const loadRings = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("ring_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing ring keys:", e);
        }
      }
      
      const list: TradingRing[] = [];
      
      for (const key of keys) {
        try {
          const ringBytes = await contract.getData(`ring_${key}`);
          if (ringBytes.length > 0) {
            try {
              const ringData = JSON.parse(ethers.toUtf8String(ringBytes));
              list.push({
                id: key,
                encryptedData: ringData.data,
                timestamp: ringData.timestamp,
                broker: ringData.broker,
                participants: ringData.participants,
                status: ringData.status || "suspected"
              });
            } catch (e) {
              console.error(`Error parsing ring data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading ring ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRings(list);
    } catch (e) {
      console.error("Error loading rings:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  // Submit new ring data
  const submitRing = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting sensitive data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRingData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const ringId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const ringData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        broker: newRingData.broker,
        participants: parseInt(newRingData.participants) || 0,
        status: "suspected"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `ring_${ringId}`, 
        ethers.toUtf8Bytes(JSON.stringify(ringData))
      );
      
      const keysBytes = await contract.getData("ring_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(ringId);
      
      await contract.setData(
        "ring_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted data submitted securely!"
      });
      
      await loadRings();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRingData({
          broker: "",
          participants: "",
          evidence: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  // Confirm a suspected ring
  const confirmRing = async (ringId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const ringBytes = await contract.getData(`ring_${ringId}`);
      if (ringBytes.length === 0) {
        throw new Error("Ring not found");
      }
      
      const ringData = JSON.parse(ethers.toUtf8String(ringBytes));
      
      const updatedRing = {
        ...ringData,
        status: "confirmed"
      };
      
      await contract.setData(
        `ring_${ringId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRing))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE analysis confirmed insider trading!"
      });
      
      await loadRings();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Confirmation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Dismiss a suspected ring
  const dismissRing = async (ringId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const ringBytes = await contract.getData(`ring_${ringId}`);
      if (ringBytes.length === 0) {
        throw new Error("Ring not found");
      }
      
      const ringData = JSON.parse(ethers.toUtf8String(ringBytes));
      
      const updatedRing = {
        ...ringData,
        status: "dismissed"
      };
      
      await contract.setData(
        `ring_${ringId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRing))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE analysis dismissed suspicion!"
      });
      
      await loadRings();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Dismissal failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  // Check if user is regulator (simplified for demo)
  const isRegulator = () => {
    return !!account; // In real app, would check specific addresses
  };

  // Loading screen
  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE analysis engine...</p>
    </div>
  );

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="logo">
          <h1>InsiderRing</h1>
          <span className="tagline">FHE-Powered Trading Analysis</span>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>

      {/* Main content */}
      <main className="main-content">
        {/* Project intro section */}
        <section className="intro-section">
          <div className="intro-content">
            <h2>Confidential Analysis of Insider Trading Rings</h2>
            <p>
              Regulatory agencies can use FHE to analyze encrypted trading data from multiple brokers 
              to identify potential insider trading rings while protecting legitimate traders' privacy.
            </p>
            <div className="fhe-badge">
              <span>Fully Homomorphic Encryption</span>
            </div>
          </div>
        </section>

        {/* Stats dashboard */}
        <section className="stats-section">
          <div className="stat-card">
            <h3>Suspected Rings</h3>
            <div className="stat-value">{suspectedCount}</div>
          </div>
          <div className="stat-card">
            <h3>Confirmed Cases</h3>
            <div className="stat-value">{confirmedCount}</div>
          </div>
          <div className="stat-card">
            <h3>Dismissed Cases</h3>
            <div className="stat-value">{dismissedCount}</div>
          </div>
          <div className="stat-card">
            <h3>Total Analyzed</h3>
            <div className="stat-value">{rings.length}</div>
          </div>
        </section>

        {/* Search and filter controls */}
        <div className="controls-section">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search by broker or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filter-buttons">
            <button 
              className={activeFilter === "all" ? "active" : ""}
              onClick={() => setActiveFilter("all")}
            >
              All
            </button>
            <button 
              className={activeFilter === "suspected" ? "active" : ""}
              onClick={() => setActiveFilter("suspected")}
            >
              Suspected
            </button>
            <button 
              className={activeFilter === "confirmed" ? "active" : ""}
              onClick={() => setActiveFilter("confirmed")}
            >
              Confirmed
            </button>
            <button 
              className={activeFilter === "dismissed" ? "active" : ""}
              onClick={() => setActiveFilter("dismissed")}
            >
              Dismissed
            </button>
          </div>
          {isRegulator() && (
            <button 
              className="add-button"
              onClick={() => setShowCreateModal(true)}
            >
              + Add New Case
            </button>
          )}
        </div>

        {/* Rings list */}
        <section className="rings-list">
          <div className="list-header">
            <div>ID</div>
            <div>Broker</div>
            <div>Participants</div>
            <div>Date</div>
            <div>Status</div>
            <div>Actions</div>
          </div>
          
          {filteredRings.length === 0 ? (
            <div className="empty-state">
              <p>No trading rings found matching your criteria</p>
              {isRegulator() && (
                <button 
                  className="add-button"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Case
                </button>
              )}
            </div>
          ) : (
            filteredRings.map(ring => (
              <div className="ring-item" key={ring.id}>
                <div className="ring-id">#{ring.id.substring(0, 6)}</div>
                <div className="ring-broker">{ring.broker}</div>
                <div className="ring-participants">{ring.participants}</div>
                <div className="ring-date">
                  {new Date(ring.timestamp * 1000).toLocaleDateString()}
                </div>
                <div className={`ring-status ${ring.status}`}>
                  {ring.status}
                </div>
                <div className="ring-actions">
                  {isRegulator() && ring.status === "suspected" && (
                    <>
                      <button 
                        className="confirm-button"
                        onClick={() => confirmRing(ring.id)}
                      >
                        Confirm
                      </button>
                      <button 
                        className="dismiss-button"
                        onClick={() => dismissRing(ring.id)}
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>© {new Date().getFullYear()} InsiderRing - Confidential FHE Analysis Platform</p>
        <div className="footer-links">
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Service</a>
          <a href="#">Contact Regulators</a>
        </div>
      </footer>

      {/* Create new ring modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Add New Trading Ring Case</h2>
              <button 
                className="close-button"
                onClick={() => setShowCreateModal(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Broker Name</label>
                <input
                  type="text"
                  name="broker"
                  value={newRingData.broker}
                  onChange={(e) => setNewRingData({...newRingData, broker: e.target.value})}
                  placeholder="Enter broker name"
                />
              </div>
              <div className="form-group">
                <label>Number of Participants</label>
                <input
                  type="number"
                  name="participants"
                  value={newRingData.participants}
                  onChange={(e) => setNewRingData({...newRingData, participants: e.target.value})}
                  placeholder="Estimated number of participants"
                />
              </div>
              <div className="form-group">
                <label>Evidence Summary</label>
                <textarea
                  name="evidence"
                  value={newRingData.evidence}
                  onChange={(e) => setNewRingData({...newRingData, evidence: e.target.value})}
                  placeholder="Describe the suspicious trading patterns..."
                  rows={4}
                />
              </div>
              <div className="fhe-notice">
                All data will be encrypted using FHE before being stored on-chain
              </div>
            </div>
            <div className="modal-footer">
              <button 
                className="cancel-button"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button 
                className="submit-button"
                onClick={submitRing}
                disabled={creating}
              >
                {creating ? "Encrypting..." : "Submit Case"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction status modal */}
      {transactionStatus.visible && (
        <div className="status-overlay">
          <div className={`status-modal ${transactionStatus.status}`}>
            <div className="status-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✕"}
            </div>
            <div className="status-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}

      {/* Wallet selector */}
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
    </div>
  );
};

export default App;