/**
 * order-records.js - TKG Barcode Ops Order Records
 */

document.addEventListener('DOMContentLoaded', () => {
    const recordsApp = {
        orders: [],
        filteredOrders: [],
        currentTab: 'ecommerce',
        chartInstance: null,
        productNames: new Set(),

        async init() {
            // Show loading placeholder initially
            this.bindEvents();
            await this.loadOrders();
            this.applyFilters();
        },

        async loadOrders() {
            try {
                this.orders = await window.AppDB.getOrders();
                this.filteredOrders = [...this.orders];
            } catch (e) {
                console.error("Failed to load live orders for records", e);
                this.orders = [];
                this.filteredOrders = [];
            }
        },

        bindEvents() {
            document.getElementById('search-input').addEventListener('input', () => this.applyFilters());
            document.getElementById('status-filter').addEventListener('change', () => this.applyFilters());
            document.getElementById('platform-filter').addEventListener('change', () => this.applyFilters());
            document.getElementById('delivery-filter').addEventListener('change', () => this.applyFilters());

            document.getElementById('tab-ecommerce').addEventListener('click', () => this.switchTab('ecommerce'));
            document.getElementById('tab-b2b').addEventListener('click', () => this.switchTab('b2b'));
        },

        switchTab(tab) {
            this.currentTab = tab;
            if (tab === 'ecommerce') {
                document.getElementById('tab-ecommerce').classList.add('active');
                document.getElementById('tab-b2b').classList.remove('active');
                document.getElementById('platform-filter').style.display = 'inline-block';
                document.getElementById('delivery-filter').style.display = 'inline-block';
            } else {
                document.getElementById('tab-b2b').classList.add('active');
                document.getElementById('tab-ecommerce').classList.remove('active');
                document.getElementById('platform-filter').style.display = 'none';
                document.getElementById('delivery-filter').style.display = 'none';
            }
            this.applyFilters();
        },

        applyFilters() {
            const search = document.getElementById('search-input').value.toLowerCase().trim();
            const statusFilter = document.getElementById('status-filter').value;
            const platformFilter = document.getElementById('platform-filter').value;
            const deliveryFilter = document.getElementById('delivery-filter').value;

            this.filteredOrders = this.orders.filter(order => {
                const isB2B = (order.platform === 'b2b') || (order.id && String(order.id).toLowerCase().startsWith('b2b'));
                if (this.currentTab === 'ecommerce' && isB2B) return false;
                if (this.currentTab === 'b2b' && !isB2B) return false;

                // Search match
                const matchSearch = !search ||
                    (order.awb && String(order.awb).toLowerCase().includes(search)) ||
                    (order.orderId && String(order.orderId).toLowerCase().includes(search));

                // Status match
                const isComplete = order.status === 'Complete' || order.status === 'Exported';
                let matchStatus = true;
                if (statusFilter === 'complete') matchStatus = isComplete;
                if (statusFilter === 'pending') matchStatus = !isComplete;

                // Platform / Delivery derives
                let platform = String(order.platform || '').toLowerCase();
                const shipper = String(order.shipper || '').toLowerCase();
                const awb = String(order.awb || '').toLowerCase();
                const id = String(order.id || '').toLowerCase();

                if (!platform) {
                    if (shipper.includes('lazada') || awb.startsWith('lz')) platform = 'lazada';
                    else if (shipper.includes('shopify') || id.startsWith('shop-')) platform = 'shopify';
                    else if (shipper.includes('tiktok') || awb.startsWith('tt')) platform = 'tiktok';
                    else platform = 'shopee';
                }

                let delivery = 'other';
                if (platform === 'b2b' || shipper.includes('b2b')) delivery = 'b2b';
                else if (shipper.includes('ninja') || awb.startsWith('ninja')) delivery = 'ninjavan';
                else if (shipper.includes('spx') || shipper.includes('pick locker') || awb.startsWith('spx')) delivery = 'spx';
                else if (shipper.includes('singpost') || shipper.includes('speedpost') || platform === 'lazada' || platform === 'shopify') delivery = 'singpost';
                else if (shipper.includes('j&t') || awb.startsWith('jt')) delivery = 'jt';

                let matchPlatform = true;
                if (this.currentTab === 'ecommerce' && platformFilter !== 'all' && platform !== platformFilter) matchPlatform = false;

                let matchDelivery = true;
                if (this.currentTab === 'ecommerce' && deliveryFilter !== 'all' && delivery !== deliveryFilter) matchDelivery = false;

                return matchSearch && matchStatus && matchPlatform && matchDelivery;
            });

            this.renderRecords();
        },

        getPlatformBadge(order) {
            let platform = String(order.platform || '').toLowerCase();
            const shipper = String(order.shipper || '').toLowerCase();
            const awb = String(order.awb || '').toLowerCase();
            const id = String(order.id || '').toLowerCase();

            if (!platform) {
                if (shipper.includes('lazada') || awb.startsWith('lz')) platform = 'lazada';
                else if (shipper.includes('shopify') || id.startsWith('shop-')) platform = 'shopify';
                else if (shipper.includes('tiktok') || awb.startsWith('tt')) platform = 'tiktok';
                else platform = 'shopee'; // default
            }

            if (platform === 'shopee') return `<span class="badge shopee">Shopee</span>`;
            if (platform === 'lazada') return `<span class="badge lazada">Lazada</span>`;
            if (platform === 'shopify') return `<span class="badge shopify">Shopify</span>`;
            if (platform === 'tiktok') return `<span class="badge tiktok">TikTok</span>`;
            if (platform === 'b2b') return `<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #a855f7;">B2B / Wholesale</span>`;

            return `<span class="badge other">Unknown</span>`;
        },

        getDeliveryBadge(order) {
            const shipper = String(order.shipper || '').toLowerCase();
            const awb = String(order.awb || '').toLowerCase();
            let platform = String(order.platform || '').toLowerCase();
            const id = String(order.id || '').toLowerCase();

            if (!platform) {
                if (shipper.includes('lazada') || awb.startsWith('lz')) platform = 'lazada';
                else if (shipper.includes('shopify') || id.startsWith('shop-')) platform = 'shopify';
                else if (shipper.includes('tiktok') || awb.startsWith('tt')) platform = 'tiktok';
                else platform = 'shopee';
            }

            if (shipper.includes('ninja') || awb.startsWith('ninja')) return `<span class="badge" style="background: rgba(192, 38, 41, 0.15); color: #ef4444;">NinjaVan</span>`;
            if (shipper.includes('spx') || shipper.includes('pick locker') || awb.startsWith('spx')) return `<span class="badge shopee">SPX Express</span>`;
            if (shipper.includes('singpost') || shipper.includes('speedpost') || platform === 'lazada' || platform === 'shopify') return `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6;">Singpost</span>`;
            if (shipper.includes('j&t') || awb.startsWith('jt')) return `<span class="badge tiktok">J&T Express</span>`;
            if (platform === 'b2b' || shipper.includes('b2b')) return `<span class="badge" style="background: rgba(100, 116, 139, 0.2); color: #cbd5e1;">Direct Dispatch</span>`;

            return `<span class="badge other">${order.shipper || 'Unknown'}</span>`;
        },

        formatDate(order) {
            // Helper to format any valid timestamp cleanly
            const formatClean = (ms) => {
                const d = new Date(ms);
                const dStr = d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                const tStr = d.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit' });
                return `${dStr}<br><span style="font-size:0.85em; color:var(--text-secondary);">${tStr}</span>`;
            };

            // Shopify orders have timestamps in ID
            if (order.id && String(order.id).startsWith("SHOP-")) {
                const ts = parseInt(String(order.id).split('-')[1]);
                if (!isNaN(ts)) return formatClean(ts);
            }
            // B2B 
            if (order.id && String(order.id).startsWith("B2B-")) {
                const ts = parseInt(String(order.id).split('-')[1]);
                if (!isNaN(ts)) {
                    let dStr = new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                    if (order.b2bTime) {
                        dStr += `<br><span style="font-size:0.85em; color:var(--text-secondary);">${String(order.b2bTime).replace(/</g, "&lt;")}</span>`;
                    }
                    return dStr;
                }
            }
            if (order.date) {
                return formatClean(new Date(order.date).getTime());
            }
            return '<span style="opacity:0.5">-</span>';
        },

        toggleItems(id) {
            const list = document.getElementById(`items-${id}`);
            const btn = document.getElementById(`btn-${id}`);
            if (list.style.display === 'none') {
                list.style.display = 'block';
                btn.textContent = 'Hide';
            } else {
                list.style.display = 'none';
                btn.textContent = 'View';
            }
        },

        async deleteOrder(orderId) {
            if (!orderId) return;
            if (confirm(`WARNING: Deleting Order Record!\n\nAre you sure you want to permanently erase this order? This will immediately restore all its items back into your active Stock Inventory natively.`)) {
                try {
                    await window.AppDB.deleteOrder(orderId);
                    await this.loadOrders();
                    this.applyFilters(); // Re-render table dynamically without flashing
                } catch (e) {
                    alert("Failed to delete order: " + e.message);
                }
            }
        },

        async cancelOrder(orderId) {
            if (!orderId) return;
            if (confirm(`Cancel Order?\n\nThis will mark the order as Cancelled and remove its stock deductions, natively restoring the items to your Live Inventory.\n\nThe order record will remain visible in your logs for auditing.`)) {
                try {
                    await window.AppDB.cancelOrder(orderId);
                    await this.loadOrders();
                    this.applyFilters();
                } catch (e) {
                    alert("Failed to cancel order: " + e.message);
                }
            }
        },

        editOrder(orderId) {
            if (!orderId) return;
            const orderIndex = this.orders.findIndex(o => o.id === orderId || o.id === parseInt(orderId));
            if (orderIndex === -1) return;
            const order = this.orders[orderIndex];

            // Deep clone lineItems for staging
            let stagedItems = JSON.parse(JSON.stringify(order.lineItems || []));

            // Setup select options
            let selectOptions = '<option value="" disabled selected>Select an item to add...</option>';
            if (typeof PRODUCT_CATALOG !== 'undefined') {
                let allProducts = [];
                for (const category in PRODUCT_CATALOG) {
                    if (category === "Aliases" || category === "Gift Box Barcodes" || category === "Merchandise") continue;
                    for (const pName in PRODUCT_CATALOG[category]) {
                        allProducts.push(pName);
                    }
                }
                allProducts.sort().forEach(p => {
                    const displayName = p.split(' ').map(w => w.match(/^\d+g$/i) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    selectOptions += `<option value="${p}">${displayName}</option>`;
                });
            }

            const modal = document.createElement('div');
            modal.style = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); backdrop-filter:blur(5px); z-index:9999; display:flex; justify-content:center; align-items:center;";
            modal.id = "edit-order-modal";

            const renderItems = () => {
                let itemsHtml = '';
                stagedItems.forEach((line, idx) => {
                    const isBundleStr = line.isBundle ? '<span style="color:#a855f7; font-size:0.75rem; font-weight:700; background:rgba(168,85,247,0.15); padding:0.2rem 0.5rem; border-radius:12px; margin-left:0.5rem; text-transform:uppercase;">Bundle</span>' : '';
                    itemsHtml += `
                        <div style="display:flex; justify-content:space-between; align-items:center; background:linear-gradient(145deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01)); padding:1rem 1.5rem; border-radius:12px; margin-bottom:0.75rem; border:1px solid rgba(255,255,255,0.05);">
                            <span style="font-weight:600; flex:1; color:white; font-size:1.05rem;">${line.name} ${isBundleStr}</span>
                            <div style="display:flex; gap:1rem; align-items:center;">
                                <label style="color:var(--text-secondary); font-size:0.9rem;">Qty:</label>
                                <input type="number" id="staged-qty-${idx}" value="${line.orderedQty}" min="0" style="width:80px; padding:0.6rem; background:rgba(0,0,0,0.4); color:var(--text-primary); border:1px solid var(--border-color); border-radius:8px; font-size:1.1rem; text-align:center; outline:none; transition:border-color 0.2s;" onchange="window.recordsApp.updateStagedQty(${idx}, this.value)">
                            </div>
                        </div>
                    `;
                });
                return itemsHtml;
            };

            const isB2B = (order.platform === 'b2b') || (order.id && String(order.id).toLowerCase().startsWith('b2b'));
            this._newPodBase64 = order.podImage || null;

            const renderPodSection = () => {
                if (!isB2B) return '';
                const previewHtml = this._newPodBase64 ?
                    `<img id="edit-pod-preview" src="${this._newPodBase64}" style="max-height:100px; border-radius:8px; border:2px solid var(--accent); margin-top:1rem; display:block; box-shadow:0 4px 6px rgba(0,0,0,0.3);">` :
                    `<img id="edit-pod-preview" src="" style="max-height:100px; border-radius:8px; border:2px solid var(--accent); margin-top:1rem; display:none; box-shadow:0 4px 6px rgba(0,0,0,0.3);">`;

                return `
                <div style="background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.05); padding:1.5rem; border-radius:12px; margin-bottom:2.5rem;">
                    <label style="display:block; color:var(--text-secondary); font-size:0.85rem; margin-bottom:0.5rem; font-weight:600; text-transform:uppercase;">Proof of Delivery Attachment</label>
                    <input type="file" id="edit-pod-upload" accept="image/*" style="width:100%; padding:0.75rem; background:rgba(0,0,0,0.4); color:white; border:1px solid var(--border-color); border-radius:8px; cursor:pointer;">
                    ${previewHtml}
                </div>
                `;
            };

            const buildHtml = () => {
                return `
                <div style="background:var(--bg-app); border:1px solid rgba(255,255,255,0.1); padding:2.5rem; border-radius:16px; max-width:650px; width:95%; max-height:85vh; overflow-y:auto; box-shadow:0 25px 50px -12px rgba(0,0,0,0.5); font-family:'Inter', sans-serif;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                        <h2 style="margin:0; color:white; font-size:1.8rem; font-weight:800;">Edit Order Content</h2>
                        <span style="background:rgba(255,255,255,0.1); padding:0.4rem 0.8rem; border-radius:8px; font-family:monospace; font-size:0.9rem; color:var(--text-secondary);">${order.awb || order.orderId || order.id}</span>
                    </div>
                    <p style="color:var(--text-secondary); margin-bottom:2rem; font-size:0.95rem; line-height:1.5;">Modify quantities below. Adding or removing items will natively and instantly synchronize with your Stock Inventory and Reports math.</p>
                    
                    <div id="modal-items-container" style="margin-bottom: 2rem;">
                        ${renderItems()}
                    </div>

                    <div style="background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.05); padding:1.5rem; border-radius:12px; margin-bottom:2.5rem;">
                        <label style="display:block; color:var(--text-secondary); font-size:0.85rem; margin-bottom:0.5rem; font-weight:600; text-transform:uppercase;">Add New Product to Historical Order</label>
                        <div style="display:flex; gap:1rem;">
                            <select id="modal-add-select" style="flex:1; padding:0.75rem; background:rgba(0,0,0,0.4); color:white; border:1px solid var(--border-color); border-radius:8px; font-size:1rem; outline:none;">
                                ${selectOptions}
                            </select>
                            <button id="btn-modal-add" style="background:var(--accent); color:white; border:none; border-radius:8px; padding:0 1.5rem; font-weight:600; cursor:pointer; font-size:0.95rem; transition:transform 0.1s;">+ Add</button>
                        </div>
                    </div>

                    ${renderPodSection()}

                    <div style="display:flex; justify-content:space-between; gap: 1rem; margin-top:1rem;">
                        <button id="btn-cancel-edit" style="background:transparent; border:1px solid rgba(255,255,255,0.1); color:var(--text-secondary); flex:1; padding:1rem; border-radius:12px; font-weight:600; cursor:pointer; font-size:1.05rem; transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">Cancel</button>
                        <button id="btn-save-edit" style="background:linear-gradient(135deg, var(--success) 0%, #059669 100%); color:white; flex:2; border:none; border-radius:12px; font-weight:700; cursor:pointer; font-size:1.05rem; box-shadow:0 4px 15px rgba(16,185,129,0.3); transition:all 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">Commit & Sync Inventory</button>
                    </div>
                </div>`;
            };

            modal.innerHTML = buildHtml();
            document.body.appendChild(modal);

            this._stagedItems = stagedItems;

            document.getElementById('btn-cancel-edit').onclick = () => {
                delete this._stagedItems;
                delete this._newPodBase64;
                modal.remove();
            };

            if (isB2B) {
                const podUpload = document.getElementById('edit-pod-upload');
                if (podUpload) {
                    podUpload.addEventListener('change', (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            const img = new Image();
                            img.onload = () => {
                                const canvas = document.createElement('canvas');
                                const MAX_WIDTH = 600;
                                let width = img.width;
                                let height = img.height;
                                if (width > MAX_WIDTH) { height = Math.round((height * MAX_WIDTH) / width); width = MAX_WIDTH; }
                                canvas.width = width;
                                canvas.height = height;
                                const ctx = canvas.getContext('2d');
                                ctx.drawImage(img, 0, 0, width, height);
                                this._newPodBase64 = canvas.toDataURL('image/jpeg', 0.5);
                                const preview = document.getElementById('edit-pod-preview');
                                if (preview) {
                                    preview.src = this._newPodBase64;
                                    preview.style.display = 'block';
                                }
                            };
                            img.src = event.target.result;
                        };
                        reader.readAsDataURL(file);
                    });
                }
            }

            document.getElementById('btn-modal-add').onclick = () => {
                const sel = document.getElementById('modal-add-select');
                const pName = sel.value;
                if (!pName) return;

                let subItems = [];
                let isBundle = false;
                if (typeof PRODUCT_CATALOG !== 'undefined') {
                    for (const cat in PRODUCT_CATALOG) {
                        if (PRODUCT_CATALOG[cat][pName]) {
                            const schema = PRODUCT_CATALOG[cat][pName];
                            if (schema.type === 'bundle' || schema.type === 'gift_box') {
                                isBundle = true;
                                if (schema.contents) {
                                    subItems = schema.contents.map(sub => ({
                                        name: sub.name.toLowerCase(),
                                        requiredQty: sub.count,
                                        scannedQty: sub.count,
                                        done: true
                                    }));
                                }
                            }
                        }
                    }
                }

                const existingItem = this._stagedItems.find(i => i.name === pName);
                if (existingItem) {
                    existingItem.orderedQty++;
                    existingItem.scannedQty++;
                    if (existingItem.isBundle && existingItem.subItems) {
                        const ratio = existingItem.orderedQty / (existingItem.orderedQty - 1);
                        existingItem.subItems.forEach(sub => {
                            sub.requiredQty = sub.requiredQty * ratio;
                            sub.scannedQty = sub.scannedQty * ratio;
                        });
                    }
                } else {
                    this._stagedItems.push({
                        id: `added-${Date.now()}`,
                        name: pName,
                        orderedQty: 1,
                        scannedQty: 1,
                        status: 'Complete',
                        isBundle: isBundle,
                        subItems: subItems.length > 0 ? subItems : null
                    });
                }

                document.getElementById('modal-items-container').innerHTML = renderItems();
                sel.value = '';
            };

            document.getElementById('btn-save-edit').onclick = async () => {
                let anyChanges = false;
                const filteredStage = this._stagedItems.filter(l => l.orderedQty > 0);
                if (JSON.stringify(order.lineItems) !== JSON.stringify(filteredStage)) {
                    order.lineItems = filteredStage;
                    anyChanges = true;
                }

                if (isB2B && this._newPodBase64 !== order.podImage) {
                    order.podImage = this._newPodBase64;
                    anyChanges = true;
                }

                if (anyChanges) {
                    document.getElementById('btn-save-edit').textContent = "Saving to Cloud...";
                    document.getElementById('btn-save-edit').disabled = true;
                    try {
                        if (order.lineItems && order.lineItems.length === 0) {
                            await AppDB.deleteOrder(order.id);
                        } else {
                            // Completely override the existing deductions by refreshing the API
                            await AppDB.deleteOrder(order.id);
                            await AppDB.fulfillOrder(order);
                        }
                        await this.loadOrders();
                        this.applyFilters();
                    } catch (e) {
                        alert("Failed to update order: " + e.message);
                    }
                }

                delete this._stagedItems;
                delete this._newPodBase64;
                modal.remove();
            };
        },

        updateStagedQty(idx, val) {
            let newQty = parseInt(val) || 0;
            const line = this._stagedItems[idx];
            if (line && line.orderedQty !== newQty) {
                if (line.isBundle && line.subItems && line.orderedQty > 0) {
                    const ratio = newQty / line.orderedQty;
                    line.subItems.forEach(sub => {
                        sub.requiredQty = sub.requiredQty * ratio;
                        sub.scannedQty = sub.scannedQty * ratio;
                    });
                }
                line.orderedQty = newQty;
                line.scannedQty = newQty;
            }
        },

        renderRecords() {
            const tbody = document.getElementById('records-tbody');
            tbody.innerHTML = '';

            if (this.filteredOrders.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 3rem; color: var(--text-secondary);">No orders found matching the criteria.</td></tr>`;
                return;
            }

            this.filteredOrders.forEach((order, idx) => {
                const tr = document.createElement('tr');

                const isComplete = order.status === 'Complete' || order.status === 'Exported';
                const statusBadge = `<span class="badge ${isComplete ? 'complete' : 'pending'}">${order.status || 'Pending'}</span>`;

                const platformBadge = this.getPlatformBadge(order);
                const deliveryBadge = this.getDeliveryBadge(order);
                const dateStr = this.formatDate(order);

                // Build a summary of items
                let itemCount = 0;
                let itemsPreview = [];
                let fullItemsList = [];

                if (order.lineItems) {
                    order.lineItems.forEach(line => {
                        const qty = line.orderedQty || 1;
                        itemCount += qty;

                        const nStr = window.formatProductName ? window.formatProductName(line.name) : line.name;
                        const mainExpBadge = line.selectedExpiry ? ` <span style="color:var(--danger); font-size:0.85em;">[Exp: ${new Date(line.selectedExpiry).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}]</span>` : '';
                        const text = `${qty}x ${nStr}${mainExpBadge}`;

                        if (itemsPreview.length < 2) itemsPreview.push(`${qty}x ${nStr}`);
                        fullItemsList.push(`<li>${text}</li>`);

                        if (line.subItems && line.subItems.length > 0) {
                            line.subItems.forEach(sub => {
                                const subNStr = window.formatProductName ? window.formatProductName(sub.name) : sub.name;
                                const expBadge = sub.selectedExpiry ? ` <span style="color:var(--danger); font-size:0.85em;">[Exp: ${new Date(sub.selectedExpiry).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}]</span>` : '';
                                fullItemsList.push(`<li style="color:var(--text-secondary); margin-left:1em;">- ${sub.requiredQty}x ${subNStr}${expBadge}</li>`);
                            });
                        }
                    });
                }

                let itemsHtml = `<div class="items-cell">${itemCount} items: ${itemsPreview.join(', ')}${itemsPreview.length < fullItemsList.length ? '...' : ''} <button id="btn-${idx}" class="btn-expand" onclick="window.recordsApp.toggleItems(${idx})">View</button></div>`;
                itemsHtml += `<ul id="items-${idx}" class="items-list-expanded" style="display:none; list-style-type: none; padding-left: 0;">${fullItemsList.join('')}</ul>`;

                const safeId = order.id ? order.id.toString().replace(/'/g, "\\'") : '';

                const podBadge = order.podImage ? `<button style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); border-radius:4px; padding:0.2rem 0.4rem; cursor:pointer; font-size:0.8rem; margin-left:0.5rem; transition:background 0.2s;" onclick="window.recordsApp.viewPod('${safeId}')" title="View Proof of Delivery">📸 POD</button>` : '';

                tr.innerHTML = `
                    <td style="color: var(--text-secondary); font-size: 0.85rem; white-space: nowrap; display:flex; align-items:center;">${dateStr} ${podBadge}</td>
                    <td style="font-weight: 600; font-family: monospace; font-size: 1.05rem;">${order.awb || "-"}</td>
                    <td style="color: var(--text-secondary);">${order.orderId || "-"}</td>
                    <td>${platformBadge}</td>
                    <td>${deliveryBadge}</td>
                    <td>${itemsHtml}</td>
                    <td>${statusBadge}</td>
                    <td style="text-align: right; white-space: nowrap;">
                        <button style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); padding: 0.35rem 0.8rem; border-radius: 8px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s; font-family:'Inter', sans-serif;" onmouseover="this.style.background='rgba(16, 185, 129, 0.25)'; this.style.transform='translateY(-1px)';" onmouseout="this.style.background='rgba(16, 185, 129, 0.15)'; this.style.transform='none';" onclick="window.recordsApp.editOrder('${safeId}')">Edit</button>
                        ${(order.status || '').toLowerCase() !== 'cancelled' ? `<button style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); padding: 0.35rem 0.8rem; border-radius: 8px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s; margin-left: 0.4rem; font-family:'Inter', sans-serif;" onmouseover="this.style.background='rgba(245, 158, 11, 0.25)'; this.style.transform='translateY(-1px)';" onmouseout="this.style.background='rgba(245, 158, 11, 0.15)'; this.style.transform='none';" onclick="window.recordsApp.cancelOrder('${safeId}')">Cancel</button>` : ''}
                        <button style="background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); padding: 0.35rem 0.8rem; border-radius: 8px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s; margin-left: 0.4rem; font-family:'Inter', sans-serif;" onmouseover="this.style.background='rgba(239, 68, 68, 0.2)'; this.style.transform='translateY(-1px)';" onmouseout="this.style.background='rgba(239, 68, 68, 0.1)'; this.style.transform='none';" onclick="window.recordsApp.deleteOrder('${safeId}')">Delete</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        },

        viewPod(orderId) {
            const order = this.orders.find(o => String(o.id) === String(orderId));
            if (!order || !order.podImage) return;

            const modal = document.createElement('div');
            modal.style = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); backdrop-filter:blur(5px); z-index:9999; display:flex; flex-direction:column; justify-content:center; align-items:center;";

            modal.innerHTML = `
                <div style="background:var(--bg-app); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:1.5rem; display:flex; flex-direction:column; align-items:center; box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
                    <h3 style="margin-top:0; color:white; margin-bottom:1rem;">Proof of Delivery</h3>
                    <img src="${order.podImage}" style="max-width:90vw; max-height:75vh; border-radius:8px; border:1px solid rgba(255,255,255,0.1);">
                    <button style="margin-top:1.5rem; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; padding:0.8rem 2rem; border-radius:8px; cursor:pointer; font-weight:600; font-family:'Inter', sans-serif;" onclick="this.closest('div').parentElement.remove()">Close</button>
                </div>
            `;
            document.body.appendChild(modal);
        }
    };

    recordsApp.init();
    window.recordsApp = recordsApp; // Expose to window for onclick handlers
});
