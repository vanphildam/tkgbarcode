/**
 * order-records.js - TKG Barcode Ops Orders + Analytics
 */

document.addEventListener('DOMContentLoaded', () => {
    const ordersAnalyticsApp = {
        orders: [],
        filteredOrders: [],
        ledger: [],
        productStats: {},
        currentSection: 'orders',
        currentOrderTab: 'ecommerce',
        chartInstance: null,
        dataLoaded: false,
        analyticsReady: false,

        async init() {
            this.cacheDom();
            this.bindEvents();
            await this.loadData();
            this.applyOrderFilters();
            this.refreshAnalytics();
        },

        cacheDom() {
            this.dom = {
                sectionTabs: document.querySelectorAll('[data-section]'),
                orderTabs: document.querySelectorAll('[data-order-tab]'),
                ordersSection: document.getElementById('orders-section'),
                analyticsSection: document.getElementById('analytics-section'),
                searchInput: document.getElementById('search-input'),
                statusFilter: document.getElementById('status-filter'),
                platformFilter: document.getElementById('platform-filter'),
                deliveryFilter: document.getElementById('delivery-filter'),
                recordsTbody: document.getElementById('records-tbody'),
                reportTbody: document.getElementById('report-tbody'),
                chartProductFilter: document.getElementById('chart-product-filter'),
                chartTimeframeFilter: document.getElementById('chart-timeframe-filter'),
                chartPlaceholder: document.getElementById('chart-placeholder-overlay'),
                chartCanvas: document.getElementById('salesChart'),
                statOutbound: document.getElementById('total-outbound-stat'),
                statDefects: document.getElementById('total-defects-stat'),
                statBestSeller: document.getElementById('best-seller-stat')
            };
        },

        bindEvents() {
            this.dom.sectionTabs.forEach((btn) => {
                btn.addEventListener('click', () => this.switchSection(btn.dataset.section));
            });

            this.dom.orderTabs.forEach((btn) => {
                btn.addEventListener('click', () => this.switchOrderTab(btn.dataset.orderTab));
            });

            const debouncedFilter = this.debounce(() => this.applyOrderFilters(), 200);
            if (this.dom.searchInput) this.dom.searchInput.addEventListener('input', debouncedFilter);
            if (this.dom.statusFilter) this.dom.statusFilter.addEventListener('change', () => this.applyOrderFilters());
            if (this.dom.platformFilter) this.dom.platformFilter.addEventListener('change', () => this.applyOrderFilters());
            if (this.dom.deliveryFilter) this.dom.deliveryFilter.addEventListener('change', () => this.applyOrderFilters());

            if (this.dom.recordsTbody) {
                this.dom.recordsTbody.addEventListener('click', (event) => {
                    const target = event.target.closest('[data-action]');
                    if (!target) return;
                    const action = target.dataset.action;
                    const orderId = target.dataset.orderId;
                    const index = target.dataset.index;

                    if (action === 'toggle-items') this.toggleItems(index);
                    if (action === 'edit') this.editOrder(orderId);
                    if (action === 'cancel') this.cancelOrder(orderId);
                    if (action === 'delete') this.deleteOrder(orderId);
                    if (action === 'view-pod') this.viewPod(orderId);
                });
            }

            if (this.dom.chartProductFilter) {
                this.dom.chartProductFilter.addEventListener('change', () => this.updateChart());
            }
            if (this.dom.chartTimeframeFilter) {
                this.dom.chartTimeframeFilter.addEventListener('change', () => this.updateChart());
            }
        },

        debounce(fn, delay) {
            let timer;
            return (...args) => {
                clearTimeout(timer);
                timer = setTimeout(() => fn.apply(this, args), delay);
            };
        },

        switchSection(section) {
            if (!section || section === this.currentSection) return;
            this.currentSection = section;

            this.dom.sectionTabs.forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.section === section);
            });

            if (this.dom.ordersSection) {
                this.dom.ordersSection.classList.toggle('active', section === 'orders');
            }
            if (this.dom.analyticsSection) {
                this.dom.analyticsSection.classList.toggle('active', section === 'analytics');
            }

            if (section === 'analytics') {
                if (!this.analyticsReady) this.refreshAnalytics();
                if (this.chartInstance) {
                    this.chartInstance.resize();
                    this.updateChart();
                }
            }
        },

        switchOrderTab(tab) {
            if (!tab || tab === this.currentOrderTab) return;
            this.currentOrderTab = tab;
            this.dom.orderTabs.forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.orderTab === tab);
            });

            if (this.dom.platformFilter && this.dom.deliveryFilter) {
                const showFilters = tab === 'ecommerce';
                this.dom.platformFilter.style.display = showFilters ? 'inline-block' : 'none';
                this.dom.deliveryFilter.style.display = showFilters ? 'inline-block' : 'none';
            }

            this.applyOrderFilters();
        },

        async loadData(force = false) {
            if (this.dataLoaded && !force) return;
            const ordersPromise = window.AppDB && window.AppDB.getOrders
                ? window.AppDB.getOrders()
                : Promise.resolve([]);
            const ledgerPromise = window.AppDB && window.AppDB.getRawLedger
                ? window.AppDB.getRawLedger()
                : Promise.resolve([]);

            const [ordersRes, ledgerRes] = await Promise.allSettled([ordersPromise, ledgerPromise]);

            if (ordersRes.status === 'fulfilled') {
                this.orders = Array.isArray(ordersRes.value) ? ordersRes.value : [];
            } else {
                console.error('Failed to load orders', ordersRes.reason);
                this.orders = [];
            }

            if (ledgerRes.status === 'fulfilled') {
                this.ledger = Array.isArray(ledgerRes.value) ? ledgerRes.value : [];
            } else {
                console.error('Failed to load ledger', ledgerRes.reason);
                this.ledger = [];
            }

            this.dataLoaded = true;
        },

        async refreshData() {
            await this.loadData(true);
            this.applyOrderFilters();
            this.refreshAnalytics();
        },

        applyOrderFilters() {
            const search = this.dom.searchInput ? this.dom.searchInput.value.toLowerCase().trim() : '';
            const statusFilter = this.dom.statusFilter ? this.dom.statusFilter.value : 'all';
            const platformFilter = this.dom.platformFilter ? this.dom.platformFilter.value : 'all';
            const deliveryFilter = this.dom.deliveryFilter ? this.dom.deliveryFilter.value : 'all';

            this.filteredOrders = this.orders.filter((order) => {
                const isB2B = this.isB2B(order);
                if (this.currentOrderTab === 'ecommerce' && isB2B) return false;
                if (this.currentOrderTab === 'b2b' && !isB2B) return false;

                const matchSearch = !search ||
                    (order.awb && String(order.awb).toLowerCase().includes(search)) ||
                    (order.orderId && String(order.orderId).toLowerCase().includes(search)) ||
                    (order.id && String(order.id).toLowerCase().includes(search));

                const isComplete = order.status === 'Complete' || order.status === 'Exported';
                let matchStatus = true;
                if (statusFilter === 'complete') matchStatus = isComplete;
                if (statusFilter === 'pending') matchStatus = !isComplete;

                const platform = this.derivePlatform(order);
                const delivery = this.deriveDelivery(order, platform);

                let matchPlatform = true;
                if (this.currentOrderTab === 'ecommerce' && platformFilter !== 'all' && platform !== platformFilter) {
                    matchPlatform = false;
                }

                let matchDelivery = true;
                if (this.currentOrderTab === 'ecommerce' && deliveryFilter !== 'all' && delivery !== deliveryFilter) {
                    matchDelivery = false;
                }

                return matchSearch && matchStatus && matchPlatform && matchDelivery;
            });

            this.renderRecords();
        },

        isB2B(order) {
            return (order.platform === 'b2b') || (order.id && String(order.id).toLowerCase().startsWith('b2b'));
        },

        derivePlatform(order) {
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

            return platform;
        },

        deriveDelivery(order, platform) {
            const shipper = String(order.shipper || '').toLowerCase();
            const awb = String(order.awb || '').toLowerCase();

            if (platform === 'b2b' || shipper.includes('b2b')) return 'b2b';
            if (shipper.includes('ninja') || awb.startsWith('ninja')) return 'ninjavan';
            if (shipper.includes('spx') || shipper.includes('pick locker') || awb.startsWith('spx')) return 'spx';
            if (shipper.includes('singpost') || shipper.includes('speedpost') || platform === 'lazada' || platform === 'shopify') return 'singpost';
            if (shipper.includes('j&t') || awb.startsWith('jt')) return 'jt';
            return 'other';
        },

        getPlatformBadge(order) {
            const platform = this.derivePlatform(order);
            const labelMap = {
                shopee: 'Shopee',
                lazada: 'Lazada',
                shopify: 'Shopify',
                tiktok: 'TikTok',
                b2b: 'B2B / Wholesale'
            };

            if (platform === 'b2b') {
                return `<span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #a855f7;">${labelMap[platform]}</span>`;
            }

            if (labelMap[platform]) return `<span class="badge ${platform}">${labelMap[platform]}</span>`;
            return '<span class="badge other">Unknown</span>';
        },

        getDeliveryBadge(order) {
            const platform = this.derivePlatform(order);
            const shipper = String(order.shipper || '').toLowerCase();
            const awb = String(order.awb || '').toLowerCase();

            if (shipper.includes('ninja') || awb.startsWith('ninja')) {
                return '<span class="badge" style="background: rgba(192, 38, 41, 0.15); color: #ef4444;">NinjaVan</span>';
            }
            if (shipper.includes('spx') || shipper.includes('pick locker') || awb.startsWith('spx')) {
                return '<span class="badge shopee">SPX Express</span>';
            }
            if (shipper.includes('singpost') || shipper.includes('speedpost') || platform === 'lazada' || platform === 'shopify') {
                return '<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6;">Singpost</span>';
            }
            if (shipper.includes('j&t') || awb.startsWith('jt')) {
                return '<span class="badge tiktok">J&T Express</span>';
            }
            if (platform === 'b2b' || shipper.includes('b2b')) {
                return '<span class="badge" style="background: rgba(100, 116, 139, 0.2); color: #cbd5e1;">Direct Dispatch</span>';
            }

            return `<span class="badge other">${this.escapeHtml(order.shipper || 'Unknown')}</span>`;
        },

        formatDate(order) {
            const formatClean = (ms) => {
                const d = new Date(ms);
                const dStr = d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                const tStr = d.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit' });
                return `${dStr}<br><span style="font-size:0.85em; color:var(--text-secondary);">${tStr}</span>`;
            };

            if (order.id && String(order.id).startsWith('SHOP-')) {
                const ts = parseInt(String(order.id).split('-')[1], 10);
                if (!isNaN(ts)) return formatClean(ts);
            }

            if (order.id && String(order.id).startsWith('B2B-')) {
                const ts = parseInt(String(order.id).split('-')[1], 10);
                if (!isNaN(ts)) {
                    let dStr = new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                    if (order.b2bTime) {
                        dStr += `<br><span style="font-size:0.85em; color:var(--text-secondary);">${this.escapeHtml(order.b2bTime)}</span>`;
                    }
                    return dStr;
                }
            }

            if (order.date) {
                return formatClean(new Date(order.date).getTime());
            }

            return '<span style="opacity:0.5">-</span>';
        },

        toggleItems(index) {
            const list = document.getElementById(`items-${index}`);
            const btn = document.getElementById(`btn-${index}`);
            if (!list || !btn) return;
            if (list.style.display === 'none' || list.style.display === '') {
                list.style.display = 'block';
                btn.textContent = 'Hide';
            } else {
                list.style.display = 'none';
                btn.textContent = 'View';
            }
        },

        async deleteOrder(orderId) {
            if (!orderId) return;
            if (confirm('WARNING: Deleting Order Record!\n\nAre you sure you want to permanently erase this order? This will immediately restore all its items back into your active Stock Inventory natively.')) {
                try {
                    await window.AppDB.deleteOrder(orderId);
                    await this.refreshData();
                } catch (e) {
                    alert('Failed to delete order: ' + e.message);
                }
            }
        },

        async cancelOrder(orderId) {
            if (!orderId) return;
            if (confirm('Cancel Order?\n\nThis will mark the order as Cancelled and remove its stock deductions, natively restoring the items to your Live Inventory.\n\nThe order record will remain visible in your logs for auditing.')) {
                try {
                    await window.AppDB.cancelOrder(orderId);
                    await this.refreshData();
                } catch (e) {
                    alert('Failed to cancel order: ' + e.message);
                }
            }
        },

        editOrder(orderId) {
            if (!orderId) return;
            const orderIndex = this.orders.findIndex((o) => o.id === orderId || o.id === parseInt(orderId, 10));
            if (orderIndex === -1) return;
            const order = this.orders[orderIndex];

            let stagedItems = JSON.parse(JSON.stringify(order.lineItems || []));

            let selectOptions = '<option value="" disabled selected>Select an item to add...</option>';
            if (typeof PRODUCT_CATALOG !== 'undefined') {
                let allProducts = [];
                for (const category in PRODUCT_CATALOG) {
                    if (category === 'Aliases' || category === 'Gift Box Barcodes' || category === 'Merchandise') continue;
                    for (const pName in PRODUCT_CATALOG[category]) {
                        allProducts.push(pName);
                    }
                }
                allProducts.sort().forEach((p) => {
                    const displayName = p.split(' ').map((w) => w.match(/^\d+g$/i) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    selectOptions += `<option value="${p}">${displayName}</option>`;
                });
            }

            const modal = document.createElement('div');
            modal.style = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); backdrop-filter:blur(5px); z-index:9999; display:flex; justify-content:center; align-items:center;';
            modal.id = 'edit-order-modal';

            const renderItems = () => {
                let itemsHtml = '';
                stagedItems.forEach((line, idx) => {
                    const isBundleStr = line.isBundle ? '<span style="color:#a855f7; font-size:0.75rem; font-weight:700; background:rgba(168,85,247,0.15); padding:0.2rem 0.5rem; border-radius:12px; margin-left:0.5rem; text-transform:uppercase;">Bundle</span>' : '';
                    itemsHtml += `
                        <div style="display:flex; justify-content:space-between; align-items:center; background:linear-gradient(145deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01)); padding:1rem 1.5rem; border-radius:12px; margin-bottom:0.75rem; border:1px solid rgba(255,255,255,0.05);">
                            <span style="font-weight:600; flex:1; color:white; font-size:1.05rem;">${line.name} ${isBundleStr}</span>
                            <div style="display:flex; gap:1rem; align-items:center;">
                                <label style="color:var(--text-secondary); font-size:0.9rem;">Qty:</label>
                                <input type="number" id="staged-qty-${idx}" value="${line.orderedQty}" min="0" style="width:80px; padding:0.6rem; background:rgba(0,0,0,0.4); color:var(--text-primary); border:1px solid var(--border-color); border-radius:8px; font-size:1.1rem; text-align:center; outline:none; transition:border-color 0.2s;" onchange="window.ordersAnalyticsApp.updateStagedQty(${idx}, this.value)">
                            </div>
                        </div>
                    `;
                });
                return itemsHtml;
            };

            const isB2B = this.isB2B(order);
            this._newPodBase64 = order.podImage || null;

            const renderPodSection = () => {
                if (!isB2B) return '';
                const previewHtml = this._newPodBase64
                    ? `<img id="edit-pod-preview" src="${this._newPodBase64}" style="max-height:100px; border-radius:8px; border:2px solid var(--accent); margin-top:1rem; display:block; box-shadow:0 4px 6px rgba(0,0,0,0.3);">`
                    : `<img id="edit-pod-preview" src="" style="max-height:100px; border-radius:8px; border:2px solid var(--accent); margin-top:1rem; display:none; box-shadow:0 4px 6px rgba(0,0,0,0.3);">`;

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
                                    subItems = schema.contents.map((sub) => ({
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

                const existingItem = this._stagedItems.find((i) => i.name === pName);
                if (existingItem) {
                    existingItem.orderedQty++;
                    existingItem.scannedQty++;
                    if (existingItem.isBundle && existingItem.subItems) {
                        const ratio = existingItem.orderedQty / (existingItem.orderedQty - 1);
                        existingItem.subItems.forEach((sub) => {
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
                const filteredStage = this._stagedItems.filter((l) => l.orderedQty > 0);
                if (JSON.stringify(order.lineItems) !== JSON.stringify(filteredStage)) {
                    order.lineItems = filteredStage;
                    anyChanges = true;
                }

                if (isB2B && this._newPodBase64 !== order.podImage) {
                    order.podImage = this._newPodBase64;
                    anyChanges = true;
                }

                if (anyChanges) {
                    const saveBtn = document.getElementById('btn-save-edit');
                    saveBtn.textContent = 'Saving to Cloud...';
                    saveBtn.disabled = true;
                    try {
                        if (order.lineItems && order.lineItems.length === 0) {
                            await AppDB.deleteOrder(order.id);
                        } else {
                            await AppDB.deleteOrder(order.id);
                            await AppDB.fulfillOrder(order);
                        }
                        await this.refreshData();
                    } catch (e) {
                        alert('Failed to update order: ' + e.message);
                    }
                }

                delete this._stagedItems;
                delete this._newPodBase64;
                modal.remove();
            };
        },

        updateStagedQty(idx, val) {
            let newQty = parseInt(val, 10) || 0;
            const line = this._stagedItems[idx];
            if (line && line.orderedQty !== newQty) {
                if (line.isBundle && line.subItems && line.orderedQty > 0) {
                    const ratio = newQty / line.orderedQty;
                    line.subItems.forEach((sub) => {
                        sub.requiredQty = sub.requiredQty * ratio;
                        sub.scannedQty = sub.scannedQty * ratio;
                    });
                }
                line.orderedQty = newQty;
                line.scannedQty = newQty;
            }
        },

        renderRecords() {
            if (!this.dom.recordsTbody) return;
            this.dom.recordsTbody.innerHTML = '';

            if (this.filteredOrders.length === 0) {
                this.dom.recordsTbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-secondary);">No orders found matching the criteria.</td></tr>';
                return;
            }

            this.filteredOrders.forEach((order, idx) => {
                const tr = document.createElement('tr');
                const isComplete = order.status === 'Complete' || order.status === 'Exported';
                const statusBadge = `<span class="badge ${isComplete ? 'complete' : 'pending'}">${this.escapeHtml(order.status || 'Pending')}</span>`;

                const platformBadge = this.getPlatformBadge(order);
                const deliveryBadge = this.getDeliveryBadge(order);
                const dateStr = this.formatDate(order);

                let itemCount = 0;
                let itemsPreview = [];
                let fullItemsList = [];

                if (order.lineItems) {
                    order.lineItems.forEach((line) => {
                        const qty = line.orderedQty || 1;
                        itemCount += qty;

                        const nStr = window.formatProductName ? window.formatProductName(line.name) : line.name;
                        const mainExpBadge = line.selectedExpiry
                            ? ` <span style="color:var(--danger); font-size:0.85em;">[Exp: ${new Date(line.selectedExpiry).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}]</span>`
                            : '';
                        const text = `${qty}x ${this.escapeHtml(nStr)}${mainExpBadge}`;

                        if (itemsPreview.length < 2) itemsPreview.push(`${qty}x ${this.escapeHtml(nStr)}`);
                        fullItemsList.push(`<li>${text}</li>`);

                        if (line.subItems && line.subItems.length > 0) {
                            line.subItems.forEach((sub) => {
                                const subNStr = window.formatProductName ? window.formatProductName(sub.name) : sub.name;
                                const expBadge = sub.selectedExpiry
                                    ? ` <span style="color:var(--danger); font-size:0.85em;">[Exp: ${new Date(sub.selectedExpiry).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}]</span>`
                                    : '';
                                fullItemsList.push(`<li style="color:var(--text-secondary); margin-left:1em;">- ${sub.requiredQty}x ${this.escapeHtml(subNStr)}${expBadge}</li>`);
                            });
                        }
                    });
                }

                let itemsHtml = `<div class="items-cell">${itemCount} items: ${itemsPreview.join(', ')}${itemsPreview.length < fullItemsList.length ? '...' : ''} <button id="btn-${idx}" class="btn-expand" data-action="toggle-items" data-index="${idx}">View</button></div>`;
                itemsHtml += `<ul id="items-${idx}" class="items-list-expanded" style="display:none;">${fullItemsList.join('')}</ul>`;

                const safeId = order.id ? String(order.id) : '';

                const podButton = order.podImage
                    ? `<button class="btn-pod" data-action="view-pod" data-order-id="${this.escapeAttr(safeId)}" title="View Proof of Delivery">POD</button>`
                    : '';

                const actionButtons = [
                    `<button class="action-btn btn-edit" data-action="edit" data-order-id="${this.escapeAttr(safeId)}">Edit</button>`
                ];
                if ((order.status || '').toLowerCase() !== 'cancelled') {
                    actionButtons.push(`<button class="action-btn btn-cancel" data-action="cancel" data-order-id="${this.escapeAttr(safeId)}">Cancel</button>`);
                }
                actionButtons.push(`<button class="action-btn btn-delete" data-action="delete" data-order-id="${this.escapeAttr(safeId)}">Delete</button>`);

                tr.innerHTML = `
                    <td style="color: var(--text-secondary); font-size: 0.85rem; white-space: nowrap; display:flex; align-items:center;">${dateStr} ${podButton}</td>
                    <td style="font-weight: 600; font-family: monospace; font-size: 1.05rem;">${this.escapeHtml(order.awb || '-')}</td>
                    <td style="color: var(--text-secondary);">${this.escapeHtml(order.orderId || '-')}</td>
                    <td>${platformBadge}</td>
                    <td>${deliveryBadge}</td>
                    <td>${itemsHtml}</td>
                    <td>${statusBadge}</td>
                    <td style="text-align: right; white-space: nowrap;">${actionButtons.join(' ')}</td>
                `;
                this.dom.recordsTbody.appendChild(tr);
            });
        },

        escapeHtml(value) {
            return String(value || '').replace(/[&<>"']/g, (char) => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[char]));
        },

        escapeAttr(value) {
            return this.escapeHtml(value).replace(/\s+/g, ' ');
        },

        viewPod(orderId) {
            const order = this.orders.find((o) => String(o.id) === String(orderId));
            if (!order || !order.podImage) return;

            const modal = document.createElement('div');
            modal.style = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); backdrop-filter:blur(5px); z-index:9999; display:flex; flex-direction:column; justify-content:center; align-items:center;';

            modal.innerHTML = `
                <div style="background:var(--bg-app); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:1.5rem; display:flex; flex-direction:column; align-items:center; box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
                    <h3 style="margin-top:0; color:white; margin-bottom:1rem;">Proof of Delivery</h3>
                    <img src="${order.podImage}" style="max-width:90vw; max-height:75vh; border-radius:8px; border:1px solid rgba(255,255,255,0.1);">
                    <button style="margin-top:1.5rem; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; padding:0.8rem 2rem; border-radius:8px; cursor:pointer; font-weight:600; font-family:'Inter', sans-serif;" onclick="this.closest('div').parentElement.remove()">Close</button>
                </div>
            `;
            document.body.appendChild(modal);
        },

        refreshAnalytics() {
            this.processData();
            this.renderStats();
            this.extractProducts();
            this.initChart();
            this.updateChart();
            this.analyticsReady = true;
        },

        canonName(n) {
            if (!n) return 'unknown';
            return window.formatProductName
                ? window.formatProductName(n).toLowerCase()
                : String(n).toLowerCase().trim();
        },

        getOrderDate(order) {
            if (order.date) {
                const d = new Date(order.date);
                if (!isNaN(d.getTime())) return d;
            }
            if (order.created_at) {
                const d = new Date(order.created_at);
                if (!isNaN(d.getTime())) return d;
            }
            if (order.id) {
                const parts = String(order.id).split('-');
                if (parts.length > 1) {
                    const ts = parseInt(parts[1], 10);
                    if (!isNaN(ts) && ts > 1000000000000) return new Date(ts);
                }
            }
            return null;
        },

        processData() {
            this.productStats = {};

            const initProduct = (rawName) => {
                const name = this.canonName(rawName);
                if (!this.productStats[name]) {
                    this.productStats[name] = {
                        inbound: 0,
                        outbound: 0,
                        defects: 0,
                        monthlyOutbound: {}
                    };
                }
                return name;
            };

            const cancelledOrderIds = new Set();
            if (Array.isArray(this.orders)) {
                this.orders.forEach((o) => {
                    if (o && o.status && String(o.status).toLowerCase() === 'cancelled') {
                        if (o.id) cancelledOrderIds.add(String(o.id));
                    }
                });
            }

            if (Array.isArray(this.ledger)) {
                this.ledger.forEach((row) => {
                    if (!row) return;
                    if (
                        row.transaction_type === 'OUTBOUND' &&
                        row.reference_id &&
                        cancelledOrderIds.has(String(row.reference_id))
                    ) return;

                    const name = initProduct(row.product_name);
                    const qty = Number(row.qty) || 0;

                    if (row.transaction_type === 'INBOUND') this.productStats[name].inbound += qty;
                    if (row.transaction_type === 'OUTBOUND') this.productStats[name].outbound += qty;
                    if (row.transaction_type === 'DEFECT') this.productStats[name].defects += qty;
                    if (row.transaction_type === 'ADJUSTMENT') {
                        if (qty > 0) this.productStats[name].inbound += qty;
                        else this.productStats[name].outbound += Math.abs(qty);
                    }
                });
            }

            if (Array.isArray(this.ledger)) {
                this.ledger.forEach((row) => {
                    if (!row || row.transaction_type !== 'OUTBOUND') return;
                    if (row.reference_id && cancelledOrderIds.has(String(row.reference_id))) return;

                    const name = initProduct(row.product_name);
                    const qty = Number(row.qty) || 0;

                    let d = null;
                    if (row.created_at) d = new Date(row.created_at);
                    else if (row.date) d = new Date(row.date);

                    if (!d || isNaN(d.getTime())) return;

                    const monthKey = d.toLocaleString('default', { month: 'short', year: 'numeric' });
                    const weekKey = (() => {
                        const wd = new Date(d);
                        const day = wd.getDay() || 7;
                        wd.setDate(wd.getDate() - (day - 1));
                        return `${wd.getFullYear()}-${String(wd.getMonth() + 1).padStart(2, '0')}-${String(wd.getDate()).padStart(2, '0')}`;
                    })();
                    const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    const yearKey = `${d.getFullYear()}`;

                    const mo = this.productStats[name].monthlyOutbound;
                    mo[`daily::${dayKey}`] = (mo[`daily::${dayKey}`] || 0) + qty;
                    mo[`weekly::${weekKey}`] = (mo[`weekly::${weekKey}`] || 0) + qty;
                    mo[`monthly::${monthKey}`] = (mo[`monthly::${monthKey}`] || 0) + qty;
                    mo[`yearly::${yearKey}`] = (mo[`yearly::${yearKey}`] || 0) + qty;
                });
            }

            if (Array.isArray(this.orders)) {
                this.orders.forEach((order) => {
                    if (!order) return;
                    const isComplete = order.status === 'Complete' || order.status === 'Exported';
                    if (!isComplete) return;

                    const d = this.getOrderDate(order);
                    if (!d) return;

                    const monthKey = d.toLocaleString('default', { month: 'short', year: 'numeric' });
                    const weekKey = (() => {
                        const wd = new Date(d);
                        const day = wd.getDay() || 7;
                        wd.setDate(wd.getDate() - (day - 1));
                        return `${wd.getFullYear()}-${String(wd.getMonth() + 1).padStart(2, '0')}-${String(wd.getDate()).padStart(2, '0')}`;
                    })();
                    const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    const yearKey = `${d.getFullYear()}`;

                    if (!Array.isArray(order.lineItems)) return;

                    order.lineItems.forEach((line) => {
                        if (!line) return;
                        const isBundle = line.subItems && Array.isArray(line.subItems) && line.subItems.length > 0;

                        if (isBundle) {
                            line.subItems.forEach((sub) => {
                                if (!sub) return;
                                const name = initProduct(sub.name);
                                const mo = this.productStats[name].monthlyOutbound;
                                const qty = (Number(sub.requiredQty) || 0) * (Number(line.orderedQty) || 1);
                                if (qty <= 0) return;

                                if (sub.scannedBreakdown && Object.keys(sub.scannedBreakdown).length > 0) {
                                    for (const [sNameRaw, sCount] of Object.entries(sub.scannedBreakdown)) {
                                        const sName = initProduct(sNameRaw);
                                        const smo = this.productStats[sName].monthlyOutbound;
                                        const addIfMissing = (key, val) => { if (!smo[key]) smo[key] = val; else smo[key] += val; };
                                        addIfMissing(`daily::${dayKey}`, Number(sCount) || 0);
                                        addIfMissing(`weekly::${weekKey}`, Number(sCount) || 0);
                                        addIfMissing(`monthly::${monthKey}`, Number(sCount) || 0);
                                        addIfMissing(`yearly::${yearKey}`, Number(sCount) || 0);
                                    }
                                } else {
                                    const addIfMissing = (key, val) => { if (!mo[key]) mo[key] = val; else mo[key] += val; };
                                    addIfMissing(`daily::${dayKey}`, qty);
                                    addIfMissing(`weekly::${weekKey}`, qty);
                                    addIfMissing(`monthly::${monthKey}`, qty);
                                    addIfMissing(`yearly::${yearKey}`, qty);
                                }
                            });
                        } else {
                            const name = initProduct(line.name);
                            const mo = this.productStats[name].monthlyOutbound;
                            const qty = Number(line.orderedQty) || 0;
                            if (qty <= 0) return;
                            const addIfMissing = (key, val) => { if (!mo[key]) mo[key] = val; else mo[key] += val; };
                            addIfMissing(`daily::${dayKey}`, qty);
                            addIfMissing(`weekly::${weekKey}`, qty);
                            addIfMissing(`monthly::${monthKey}`, qty);
                            addIfMissing(`yearly::${yearKey}`, qty);
                        }
                    });
                });
            }
        },

        renderStats() {
            if (!this.dom.reportTbody) return;
            this.dom.reportTbody.innerHTML = '';

            let totalOutboundAll = 0;
            let totalDefectsAll = 0;

            const productRows = Object.keys(this.productStats).map((name) => {
                const stat = this.productStats[name];
                const dynStock = stat.inbound - stat.outbound - stat.defects;
                totalOutboundAll += stat.outbound;
                totalDefectsAll += stat.defects;
                return { name, ...stat, dynStock };
            });

            productRows.sort((a, b) => b.outbound - a.outbound);

            productRows.forEach((row) => {
                const tr = document.createElement('tr');
                const lowStockClass = row.dynStock < 10 && row.inbound > 0
                    ? 'color: var(--danger); font-weight: bold;'
                    : '';
                const safeName = row.name.replace(/'/g, "\\'");
                const displayName = window.formatProductName ? window.formatProductName(row.name) : row.name;
                const linkedName = `<a onclick="window.ordersAnalyticsApp.selectChartProduct('${safeName}')" style="cursor:pointer;color:var(--accent);text-decoration:underline;font-weight:500;">${this.escapeHtml(displayName)}</a>`;

                tr.innerHTML = `
                    <td style="font-weight:600;">${linkedName}</td>
                    <td style="text-align:center;color:var(--success);">${row.inbound}</td>
                    <td style="text-align:center;color:#a855f7;">${row.outbound}</td>
                    <td style="text-align:center;color:var(--danger);">${row.defects}</td>
                    <td style="text-align:center;font-size:1.1rem;${lowStockClass}">${row.dynStock}</td>
                `;
                this.dom.reportTbody.appendChild(tr);
            });

            if (this.dom.statOutbound) this.dom.statOutbound.textContent = totalOutboundAll;
            if (this.dom.statDefects) this.dom.statDefects.textContent = totalDefectsAll;
            if (this.dom.statBestSeller && productRows.length > 0) {
                const bestName = window.formatProductName ? window.formatProductName(productRows[0].name) : productRows[0].name;
                this.dom.statBestSeller.textContent = bestName;
            }
        },

        extractProducts() {
            if (!this.dom.chartProductFilter) return;
            const productSelect = this.dom.chartProductFilter;
            const currentValue = productSelect.value;

            while (productSelect.options.length > 2) productSelect.remove(2);

            const productNames = Object.keys(this.productStats).sort();
            productNames.forEach((name) => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = window.formatProductName ? window.formatProductName(name) : name;
                productSelect.appendChild(opt);
            });

            if (currentValue) {
                productSelect.value = currentValue;
            }
        },

        selectChartProduct(productName) {
            if (this.dom.chartProductFilter) {
                this.dom.chartProductFilter.value = productName;
                this.updateChart();
            }
            const cs = document.querySelector('.chart-container');
            if (cs) cs.scrollIntoView({ behavior: 'smooth', block: 'center' });
        },

        initChart() {
            if (!this.dom.chartCanvas) return;
            if (this.chartInstance) return;

            const ctx = this.dom.chartCanvas.getContext('2d');
            Chart.defaults.color = 'rgba(255,255,255,0.7)';
            Chart.defaults.font.family = "'Inter', sans-serif";

            this.chartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Sales Vol (Qty)',
                        data: [],
                        borderColor: '#fbbf24',
                        backgroundColor: 'rgba(251,191,36,0.1)',
                        borderWidth: 2,
                        pointBackgroundColor: '#fff',
                        pointBorderColor: '#fbbf24',
                        pointBorderWidth: 2,
                        pointRadius: 4,
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(0,0,0,0.8)',
                            titleColor: '#fff',
                            bodyColor: '#fbbf24',
                            padding: 10,
                            displayColors: false
                        }
                    },
                    scales: {
                        x: { grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false } },
                        y: {
                            beginAtZero: true,
                            ticks: { precision: 0 },
                            grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false }
                        }
                    }
                }
            });
        },

        updateChart() {
            if (!this.chartInstance || !this.dom.chartProductFilter || !this.dom.chartTimeframeFilter) return;

            const productFilter = this.dom.chartProductFilter.value;
            const timeframe = this.dom.chartTimeframeFilter.value;

            if (!productFilter || productFilter === '') {
                if (this.dom.chartPlaceholder) this.dom.chartPlaceholder.style.display = 'flex';
                if (this.dom.chartCanvas) this.dom.chartCanvas.style.opacity = '0';
                return;
            }
            if (this.dom.chartPlaceholder) this.dom.chartPlaceholder.style.display = 'none';
            if (this.dom.chartCanvas) this.dom.chartCanvas.style.opacity = '1';

            const prefix = `${timeframe}::`;
            const salesData = {};

            const collectFor = (stats) => {
                Object.entries(stats.monthlyOutbound).forEach(([key, qty]) => {
                    if (!key.startsWith(prefix)) return;
                    const dateKey = key.slice(prefix.length);
                    salesData[dateKey] = (salesData[dateKey] || 0) + qty;
                });
            };

            if (productFilter === 'all') {
                Object.values(this.productStats).forEach((stats) => collectFor(stats));
            } else {
                const stats = this.productStats[productFilter];
                if (stats) collectFor(stats);
            }

            const sortedDates = Object.keys(salesData).sort((a, b) => {
                const da = new Date(a), db = new Date(b);
                if (!isNaN(da) && !isNaN(db)) return da - db;
                return a.localeCompare(b);
            });

            const dataPoints = sortedDates.map((d) => salesData[d]);
            const labels = timeframe === 'weekly'
                ? sortedDates.map((d) => 'Week of ' + d)
                : sortedDates;

            const pName = productFilter === 'all'
                ? 'All Products'
                : (window.formatProductName ? window.formatProductName(productFilter) : productFilter);

            this.chartInstance.data.datasets[0].label = `${pName} - Sales Vol`;
            this.chartInstance.data.labels = labels;
            this.chartInstance.data.datasets[0].data = dataPoints;
            this.chartInstance.update();
        }
    };

    ordersAnalyticsApp.init();
    window.ordersAnalyticsApp = ordersAnalyticsApp;
});
