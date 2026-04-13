/**
 * notifications.js
 * Handles checking for expiring stock and displaying alerts in the header.
 */

(function () {
    // Configuration
    const EXPIRY_THRESHOLD_DAYS = 90; // 3 months roughly
    const STORAGE_KEY = 'tkg_inventory';

    // SVG Icons
    const BELL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`;
    const WARNING_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--danger)"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

    // CSS Styles for Notification System
    const styles = `
        .notification-bell {
            position: relative;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: var(--text-primary, #fff);
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s;
            margin-left: 1rem;
        }
        .notification-bell:hover {
            background: rgba(255, 255, 255, 0.1);
            transform: scale(1.05);
        }
        .notification-badge {
            position: absolute;
            top: -2px;
            right: -2px;
            background: var(--danger, #ef4444);
            color: white;
            font-size: 0.7rem;
            font-weight: 700;
            min-width: 18px;
            height: 18px;
            border-radius: 9px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0 4px;
            border: 2px solid var(--bg-app, #09090b);
            animation: pulse-badge 2s infinite;
        }
        @keyframes pulse-badge {
            0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
            70% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
            100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        
        /* Modal / Dropdown */
        .notif-dropdown {
            position: absolute;
            top: 60px; /* Below header */
            right: 20px;
            width: 380px;
            max-width: 90vw;
            background: rgba(20, 20, 25, 0.95);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            opacity: 0;
            transform: translateY(-10px);
            pointer-events: none;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .notif-dropdown.active {
            opacity: 1;
            transform: translateY(0);
            pointer-events: all;
        }
        .notif-header {
            padding: 1rem 1.25rem;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(255,255,255,0.02);
        }
        .notif-header h3 { margin: 0; font-size: 1rem; font-weight: 600; color: var(--text-primary, #fff); }
        .notif-close { background: none; border: none; color: var(--text-secondary, #a1a1aa); cursor: pointer; font-size: 1.25rem; padding: 0.25rem; display: flex; align-items: center; }
        .notif-close:hover { color: #fff; }
        
        .notif-body {
            max-height: 400px;
            overflow-y: auto;
            padding: 0.5rem;
        }
        .notif-item {
            display: flex;
            align-items: flex-start;
            gap: 1rem;
            padding: 0.75rem 1rem;
            border-radius: 8px;
            transition: background 0.2s;
            border-bottom: 1px solid rgba(255,255,255,0.03);
        }
        .notif-item:last-child { border-bottom: none; }
        .notif-item:hover { background: rgba(255,255,255,0.03); }
        
        .notif-icon-box {
            width: 32px; height: 32px;
            background: rgba(239, 68, 68, 0.1);
            color: #ef4444;
            border-radius: 8px;
            display: flex; align-items: center; justify-content: center;
            flex-shrink: 0;
        }
        .notif-content { flex: 1; min-width: 0; }
        .notif-title { font-size: 0.9rem; font-weight: 600; color: var(--text-primary, #fff); margin-bottom: 2px; }
        .notif-subtitle { font-size: 0.8rem; color: var(--text-secondary, #a1a1aa); }
        .notif-date { font-size: 0.75rem; color: #ef4444; font-weight: 500; margin-top: 4px; display: block; }
        
        .notif-empty {
            padding: 2rem;
            text-align: center;
            color: var(--text-secondary, #a1a1aa);
            font-size: 0.9rem;
        }

        /* Scrollbar */
        .notif-body::-webkit-scrollbar { width: 6px; }
        .notif-body::-webkit-scrollbar-track { background: transparent; }
        .notif-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
    `;

    function injectStyles() {
        const styleEl = document.createElement('style');
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }

    async function getExpiringItems() {
        try {
            // Clear legacy local storage to permanently remove ghost notifications
            localStorage.removeItem(STORAGE_KEY);
            
            if (!window.AppDB) return [];
            const inventory = await window.AppDB.getComputedInventory();
            
            const expiringItems = [];
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const warningDate = new Date();
            warningDate.setDate(today.getDate() + EXPIRY_THRESHOLD_DAYS);

            for (const [productName, batches] of Object.entries(inventory)) {
                if (!Array.isArray(batches)) continue;

                batches.forEach(batch => {
                    if (!batch.expiry || batch.qty <= 0) return;

                    const expiryDate = new Date(batch.expiry);
                    // Check valid date
                    if (isNaN(expiryDate.getTime())) return;

                    // Logic: If expiry date is BEFORE warning date (Meaning it expires within threshold)
                    // AND not consumed yet (handled by qty > 0 check)
                    // We also include already expired items
                    if (expiryDate <= warningDate) {
                        const daysLeft = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

                        expiringItems.push({
                            name: productName,
                            expiry: batch.expiry,
                            qty: batch.qty,
                            daysLeft: daysLeft
                        });
                    }
                });
            }

            // Sort by most urgent (lowest days left)
            return expiringItems.sort((a, b) => a.daysLeft - b.daysLeft);

        } catch (e) {
            console.error("Error checking expiring items:", e);
            return [];
        }
    }

    function createNotificationUI(items) {
        // 1. Find Header
        const header = document.querySelector('header');
        if (!header) return;

        // Ensure header actions container exists
        let actions = header.querySelector('.header-actions');
        if (!actions) {
            // Some pages might not have header-actions div, so append to header directly or create one
            // Ideally we prepend or append based on layout. 
            // Most pages seem to have a logo on left.
            actions = document.createElement('div');
            actions.className = 'header-actions';
            actions.style.display = 'flex';
            actions.style.alignItems = 'center';
            actions.style.marginLeft = 'auto'; // Push to right
            header.appendChild(actions);
        } else {
            actions.style.display = 'flex';
            actions.style.alignItems = 'center';
        }

        // 2. Create Bell
        const bellBtn = document.createElement('div');
        bellBtn.className = 'notification-bell';
        bellBtn.innerHTML = BELL_ICON;
        bellBtn.title = "Expiry Notifications";

        if (items.length > 0) {
            const badge = document.createElement('div');
            badge.className = 'notification-badge';
            badge.textContent = items.length > 99 ? '99+' : items.length;
            bellBtn.appendChild(badge);
        }

        // 3. Create Dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'notif-dropdown';
        dropdown.innerHTML = `
            <div class="notif-header">
                <h3>Expiring Stock Alerts</h3>
                <button class="notif-close" onclick="this.closest('.notif-dropdown').classList.remove('active')">✕</button>
            </div>
            <div class="notif-body">
                ${items.length === 0 ? '<div class="notif-empty">No upcoming expiries found within 3 months.</div>' : ''}
            </div>
        `;

        const listBody = dropdown.querySelector('.notif-body');
        items.forEach(item => {
            const isExpired = item.daysLeft < 0;
            const dayText = isExpired ? `Expired ${Math.abs(item.daysLeft)} days ago` : `Expires in ${item.daysLeft} days`;
            const dateStr = new Date(item.expiry).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

            const div = document.createElement('div');
            div.className = 'notif-item';
            div.innerHTML = `
                <div class="notif-icon-box" style="${isExpired ? 'background:rgba(239,68,68,0.2)' : 'background:rgba(245,158,11,0.15); color:#f59e0b'}">
                    ${WARNING_ICON}
                </div>
                <div class="notif-content">
                    <div class="notif-title">${item.name.charAt(0).toUpperCase() + item.name.slice(1)}</div>
                    <div class="notif-subtitle">Qty: ${item.qty} units</div>
                    <span class="notif-date" style="${isExpired ? 'color:#ef4444' : 'color:#f59e0b'}">${dayText} (${dateStr})</span>
                </div>
            `;
            listBody.appendChild(div);
        });

        // 4. Events
        bellBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('active');
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && !bellBtn.contains(e.target)) {
                dropdown.classList.remove('active');
            }
        });

        // Append
        actions.prepend(bellBtn); // Put it before other buttons if any
        document.body.appendChild(dropdown); // Append to body to avoid overflow clipping issues
    }

    // Initialize
    async function init() {
        injectStyles();
        const expiring = await getExpiringItems();
        createNotificationUI(expiring);
    }

    // Run on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
