/**
 * b2b-outbound.js
 * Handles custom B2B bulk orders without barcodes directly into our ledger
 */

document.addEventListener('DOMContentLoaded', () => {
    const app = {
        cart: [],
        products: [],

        async init() {
            this.podBase64 = null;
            this.inventory = {};
            await this.loadOverrides();
            await this.loadInventory();
            this.loadProducts();
            this.bindEvents();
            this.renderCart();
        },

        async loadOverrides() {
            try {
                const dbProducts = await window.AppDB.getProducts();
                if (dbProducts && Object.keys(dbProducts).length > 0) {
                    console.log("Loaded native DB DB catalog for B2B.");
                    for (const [name, data] of Object.entries(dbProducts)) {
                        
                        // Merge into PRODUCT_CATALOG for loadProducts to find
                        let found = false;
                        for (const cat in PRODUCT_CATALOG) {
                            if (PRODUCT_CATALOG[cat][name]) {
                                PRODUCT_CATALOG[cat][name] = { ...PRODUCT_CATALOG[cat][name], ...data };
                                found = true;
                                break;
                            }
                        }
                        if (!found && data.type) {
                            if (!PRODUCT_CATALOG["Cloud Sync"]) PRODUCT_CATALOG["Cloud Sync"] = {};
                            PRODUCT_CATALOG["Cloud Sync"][name] = data;
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to load native DB catalog", e);
            }
        },

        async loadInventory() {
            try {
                this.inventory = await window.AppDB.getComputedInventory();
            } catch (e) {
                console.error("Failed to load inventory for b2b", e);
                this.inventory = {};
            }
        },

        loadProducts() {
            if (typeof PRODUCT_CATALOG === 'undefined') return;

            let allProducts = [];
            for (const category in PRODUCT_CATALOG) {
                if (category === "Aliases" || category === "Gift Box Barcodes" || category === "Merchandise") continue;
                for (const pName in PRODUCT_CATALOG[category]) {
                    // Try to fetch image
                    let imgSrc = "images/Logo.webp";
                    if (IMAGE_DB && IMAGE_DB[pName] && IMAGE_DB[pName].trim() !== "") {
                        imgSrc = IMAGE_DB[pName];
                    }
                    allProducts.push({ name: pName, category: category, image: imgSrc });
                }
            }

            this.products = allProducts.sort((a,b) => a.name.localeCompare(b.name));
            this.renderCatalog();
        },

        renderCatalog(searchQuery = '') {
            const grid = document.getElementById('catalog-grid');
            if(!grid) return;
            grid.innerHTML = '';
            
            const q = searchQuery.toLowerCase();
            const filtered = this.products.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));

            filtered.forEach(p => {
                const card = document.createElement('div');
                card.style = "background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 1rem; cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; align-items: center; text-align: center;";
                card.onmouseover = () => { card.style.background = 'rgba(59,130,246,0.1)'; card.style.borderColor = 'var(--accent)'; card.style.transform = 'translateY(-2px)'; };
                card.onmouseout = () => { card.style.background = 'rgba(255,255,255,0.03)'; card.style.borderColor = 'rgba(255,255,255,0.1)'; card.style.transform = 'none'; };
                
                card.onclick = () => {
                    const hiddenInput = document.getElementById('b2b-product');
                    const label = document.getElementById('selected-product-label');
                    
                    hiddenInput.value = p.name;
                    label.style.display = 'block';
                    label.innerHTML = `Selected: ${window.formatProductName ? window.formatProductName(p.name) : p.name} <span style="cursor:pointer; float:right; opacity:0.7;" onclick="event.stopPropagation(); document.getElementById('b2b-product').value=''; document.getElementById('selected-product-label').style.display='none'; document.getElementById('expiry-container').style.display='none';">&times; Clear</span>`;
                    
                    this.handleProductSelection();
                    document.getElementById('catalog-modal').classList.add('hidden');
                };

                const fName = window.formatProductName ? window.formatProductName(p.name) : p.name;
                card.innerHTML = `
                    <div style="width: 100px; height: 100px; margin-bottom: 1rem; display: flex; align-items: center; justify-content: center;">
                        <img src="${p.image}" style="max-width: 100%; max-height: 100%; object-fit: contain;">
                    </div>
                    <span style="font-weight: 600; font-size: 0.95rem; color: white;">${fName}</span>
                    <span style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.5rem; text-transform: uppercase;">${p.category}</span>
                `;
                grid.appendChild(card);
            });
        },

        bindEvents() {
            document.getElementById('btn-open-catalog').addEventListener('click', () => {
                document.getElementById('catalog-modal').classList.remove('hidden');
                document.getElementById('catalog-search').focus();
            });
            document.getElementById('close-catalog-btn').addEventListener('click', () => {
                document.getElementById('catalog-modal').classList.add('hidden');
            });
            document.getElementById('catalog-search').addEventListener('input', (e) => {
                this.renderCatalog(e.target.value);
            });

            document.getElementById('btn-add-item').addEventListener('click', () => this.addItem());
            document.getElementById('btn-submit-order').addEventListener('click', () => this.submitOrder());
            document.getElementById('b2b-pod-image').addEventListener('change', (e) => this.handleImageUpload(e));
            document.getElementById('btn-remove-pod').addEventListener('click', () => this.removeImage());
        },

        handleProductSelection() {
            const product = document.getElementById('b2b-product').value;
            const expiryContainer = document.getElementById('expiry-container');
            const expirySelect = document.getElementById('b2b-expiry');
            
            expirySelect.innerHTML = '<option value="auto">Auto-deduct (FIFO)</option>';

            // If it's a bundle, they can't target a specific batch easily directly via one dropdown
            let isBundle = false;
            for (const cat in PRODUCT_CATALOG) {
                if (PRODUCT_CATALOG[cat][product] && (PRODUCT_CATALOG[cat][product].type === 'bundle' || PRODUCT_CATALOG[cat][product].type === 'gift_box')) {
                    isBundle = true;
                }
            }
            
            if (isBundle) {
                expiryContainer.style.display = 'none';
                return;
            }

            const batches = this.inventory[product];
            if (batches && Array.isArray(batches) && batches.length > 0) {
                let hasValidExp = false;
                batches.forEach(b => {
                    const dtFormat = b.expiry ? new Date(b.expiry).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'No Expiry';
                    const batchString = b.batch ? ` (B: ${b.batch})` : '';
                    const availQty = b.computedQty ?? b.qty ?? 0;
                    if (availQty > 0) {
                        hasValidExp = true;
                        const opt = document.createElement('option');
                        opt.value = JSON.stringify({ expiry: b.expiry, batch: b.batch });
                        opt.textContent = `${dtFormat}${batchString} [Qty: ${availQty}]`;
                        expirySelect.appendChild(opt);
                    }
                });
                
                if (hasValidExp) {
                    expiryContainer.style.display = 'block';
                } else {
                    expiryContainer.style.display = 'none';
                }
            } else {
                expiryContainer.style.display = 'none';
            }
        },

        handleImageUpload(e) {
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

                    if (width > MAX_WIDTH) {
                        height = Math.round((height * MAX_WIDTH) / width);
                        width = MAX_WIDTH;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Compress to JPG at 0.5 quality (brings MB images down to ~30-50KB)
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
                    this.podBase64 = dataUrl;
                    
                    document.getElementById('pod-preview').src = dataUrl;
                    document.getElementById('pod-preview-container').style.display = 'flex';
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        },

        removeImage() {
            this.podBase64 = null;
            document.getElementById('b2b-pod-image').value = '';
            document.getElementById('pod-preview').src = '';
            document.getElementById('pod-preview-container').style.display = 'none';
        },

        addItem() {
            const prodSelect = document.getElementById('b2b-product');
            const qtyInput = document.getElementById('b2b-qty');
            const expSelect = document.getElementById('b2b-expiry');
            const expContainer = document.getElementById('expiry-container');

            const name = prodSelect.value;
            const qty = parseInt(qtyInput.value) || 0;

            if (!name) return this.showToast('Please select a product', 'error');
            if (qty <= 0) return this.showToast('Quantity must be greater than 0', 'error');

            let selectedExpiry = null;
            let selectedBatch = null;

            if (expContainer.style.display !== 'none' && expSelect.value !== 'auto') {
                try {
                    const parsed = JSON.parse(expSelect.value);
                    selectedExpiry = parsed.expiry || null;
                    selectedBatch = parsed.batch || null;
                } catch(e) {}
            }

            const existing = this.cart.find(item => item.name === name && item.selectedExpiry === selectedExpiry && item.selectedBatch === selectedBatch);
            if (existing) {
                existing.qty += qty;
            } else {
                this.cart.push({ name, qty, selectedExpiry, selectedBatch });
            }

            prodSelect.value = '';
            qtyInput.value = 1;
            expContainer.style.display = 'none';
            document.getElementById('selected-product-label').style.display = 'none';
            this.renderCart();
        },

        removeItem(index) {
            this.cart.splice(index, 1);
            this.renderCart();
        },

        renderCart() {
            const tbody = document.getElementById('cart-tbody');
            const submitBtn = document.getElementById('btn-submit-order');
            const totalSpan = document.getElementById('total-qty');

            tbody.innerHTML = '';

            let totalQty = 0;

            if (this.cart.length === 0) {
                tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary);">No items added yet.</td></tr>`;
                submitBtn.disabled = true;
                totalSpan.textContent = "0";
                return;
            }

            submitBtn.disabled = false;

            this.cart.forEach((item, idx) => {
                totalQty += item.qty;
                const tr = document.createElement('tr');
                const displayName = window.formatProductName ? window.formatProductName(item.name) : item.name.split(' ').map(w => w.match(/^\d+g$/i) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                
                let detailsHtml = '';
                if (item.selectedExpiry) {
                    const expForm = new Date(item.selectedExpiry).toLocaleString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'});
                    detailsHtml += `<span style="font-size:0.8rem; color:var(--text-secondary); display:block;">Exp: ${expForm}</span>`;
                }
                if (item.selectedBatch) {
                    detailsHtml += `<span style="font-size:0.8rem; color:var(--text-secondary); display:block;">Batch: ${item.selectedBatch}</span>`;
                }

                tr.innerHTML = `
                    <td style="font-weight: 500;">${displayName}${detailsHtml}</td>
                    <td>${item.qty}</td>
                    <td><button class="btn-remove" onclick="window.b2bApp.removeItem(${idx})">Remove</button></td>
                `;
                tbody.appendChild(tr);
            });

            totalSpan.textContent = totalQty;
        },

        async submitOrder() {
            const submitBtn = document.getElementById('btn-submit-order');
            if (submitBtn.disabled) return;
            submitBtn.disabled = true; // prevent double clicks immediately

            const dateInput = document.getElementById('b2b-date').value;
            const timeInput = document.getElementById('b2b-time').value.trim();
            const nameInput = document.getElementById('b2b-name').value.trim();
            const contactInput = document.getElementById('b2b-contact').value.trim();
            const addressInput = document.getElementById('b2b-address').value.trim();

            if (!nameInput) {
                submitBtn.disabled = false;
                return this.showToast('Please enter a Client Name or PO Number!', 'error');
            }
            if (this.cart.length === 0) {
                submitBtn.disabled = false;
                return this.showToast('Cart is empty', 'error');
            }

            const parts = [];
            parts.push(nameInput);
            if (contactInput) parts.push(`POC: ${contactInput}`);
            if (addressInput) parts.push(`[${addressInput}]`);
            const refInput = parts.join(' | ');

            // Create fake order object conforming to how Order Records expects it
            const dt = dateInput ? new Date(dateInput) : new Date();

            /* 
               If the item is a bundle, we need to extract `subItems` 
               so that reports.js correctly decrements the inventory. 
               This is important for B2B sending out a giftbox!
            */
            const lineItems = this.cart.map((cartItem, idx) => {
                let subItems = [];
                let isBundle = false;

                for (const cat in PRODUCT_CATALOG) {
                    if (PRODUCT_CATALOG[cat][cartItem.name]) {
                        const schema = PRODUCT_CATALOG[cat][cartItem.name];
                        if (schema.type === 'bundle' || schema.type === 'gift_box') {
                            isBundle = true;
                            if (schema.contents) {
                                subItems = schema.contents.map(sub => ({
                                    name: sub.name.toLowerCase(),
                                    requiredQty: sub.count * cartItem.qty,
                                    scannedQty: sub.count * cartItem.qty,
                                    done: true
                                }));
                            }
                        }
                    }
                }

                return {
                    id: `b2b-line-${idx}`,
                    name: cartItem.name,
                    orderedQty: cartItem.qty,
                    status: 'Complete',
                    isBundle: isBundle,
                    subItems: subItems.length > 0 ? subItems : null,
                    selectedExpiry: cartItem.selectedExpiry || undefined,
                    selectedBatch: cartItem.selectedBatch || undefined
                };
            });

            const b2bOrderId = 'B2B-' + dt.getTime();

            const newOrder = {
                id: b2bOrderId,
                orderId: refInput, // Displayed in "Order ID" column
                awb: b2bOrderId, // AWB column
                platform: 'b2b',
                shipper: 'b2b-logistics',
                date: dt.toISOString(),
                b2bTime: timeInput || null,
                status: 'Complete',
                lineItems: lineItems,
                podImage: this.podBase64 || null
            };

            // Save to Cloud DB via Ledger System
            try {
                await window.AppDB.fulfillOrder(newOrder);

                this.showToast('B2B Order Successfully Committed to Cloud!', 'success');
            } catch(e) {
                submitBtn.disabled = false;
                return this.showToast('Failed to save to cloud: ' + e.message, 'error');
            }

            const ogText = submitBtn.textContent;
            submitBtn.textContent = '✅ SUCCESSFULLY DONE!';
            submitBtn.style.background = '#10b981';
            submitBtn.style.transform = 'scale(1.02)';

            setTimeout(() => {
                submitBtn.textContent = ogText;
                submitBtn.style.background = '';
                submitBtn.style.transform = '';
                submitBtn.disabled = false;
                
                // Reset
                this.cart = [];
                this.removeImage();
                document.getElementById('b2b-date').value = '';
                document.getElementById('b2b-time').value = '';
                document.getElementById('b2b-name').value = '';
                document.getElementById('b2b-contact').value = '';
                document.getElementById('b2b-address').value = '';
                this.renderCart();
            }, 2000);
        },

        showToast(msg, type = 'success') {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.style.background = type === 'success' ? '#10b981' : '#ef4444';
            toast.style.color = '#fff';
            toast.style.padding = '12px 24px';
            toast.style.borderRadius = '8px';
            toast.style.marginTop = '10px';
            toast.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
            toast.style.fontFamily = "'Inter', sans-serif";
            toast.style.fontSize = '0.95rem';
            toast.style.animation = 'slideInRight 0.3s ease-out';
            toast.textContent = msg;

            container.appendChild(toast);

            setTimeout(() => {
                toast.style.animation = 'fadeOut 0.3s ease forwards';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }
    };

    app.init();
    window.b2bApp = app;
});
