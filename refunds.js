/**
 * refunds.js - TKG Barcode Ops Issue Management (Refunds + Defects)
 */

document.addEventListener('DOMContentLoaded', () => {
    const toastContainer = document.getElementById('toast-container');

    const toast = {
        show(message, type = 'success') {
            if (!toastContainer) return;
            const el = document.createElement('div');
            el.className = `toast ${type}`;
            el.textContent = message;
            toastContainer.appendChild(el);
            setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(10px)'; }, 2800);
            setTimeout(() => el.remove(), 3200);
        }
    };

    const issueApp = {
        currentTab: 'refunds',
        init() {
            this.cacheDom();
            this.bindEvents();
            this.refunds.init();
            this.defects.init();
        },

        cacheDom() {
            this.dom = {
                tabButtons: document.querySelectorAll('[data-issue-tab]'),
                refundsSection: document.getElementById('refunds-section'),
                defectsSection: document.getElementById('defects-section')
            };
        },

        bindEvents() {
            this.dom.tabButtons.forEach((btn) => {
                btn.addEventListener('click', () => this.switchTab(btn.dataset.issueTab));
            });
        },

        switchTab(tab) {
            if (!tab || tab === this.currentTab) return;
            this.currentTab = tab;

            this.dom.tabButtons.forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.issueTab === tab);
            });

            if (this.dom.refundsSection) {
                this.dom.refundsSection.classList.toggle('active', tab === 'refunds');
            }
            if (this.dom.defectsSection) {
                this.dom.defectsSection.classList.toggle('active', tab === 'defects');
            }
        }
    };

    const refundStore = {
        lsKey: 'tkg_refunds',

        getLocal() {
            try { return JSON.parse(localStorage.getItem(this.lsKey) || '[]'); }
            catch { return []; }
        },

        saveLocal(records) {
            localStorage.setItem(this.lsKey, JSON.stringify(records));
        },

        async getAll() {
            if (window.AppDB && typeof window.AppDB.getRefunds === 'function') {
                return await window.AppDB.getRefunds();
            }
            return this.getLocal();
        },

        async save(record) {
            if (window.AppDB && typeof window.AppDB.saveRefund === 'function') {
                return await window.AppDB.saveRefund(record);
            }
            const all = this.getLocal();
            all.unshift(record);
            this.saveLocal(all);
            return record;
        },

        async update(id, changes) {
            if (window.AppDB && typeof window.AppDB.updateRefund === 'function') {
                return await window.AppDB.updateRefund(id, changes);
            }
            const all = this.getLocal();
            const idx = all.findIndex(r => r.id === id);
            if (idx !== -1) {
                Object.assign(all[idx], changes);
                this.saveLocal(all);
            }
        },

        async remove(id) {
            if (window.AppDB && typeof window.AppDB.deleteRefund === 'function') {
                return await window.AppDB.deleteRefund(id);
            }
            const all = this.getLocal().filter(r => r.id !== id);
            this.saveLocal(all);
        }
    };

    issueApp.refunds = {
        records: [],
        filtered: [],

        init() {
            this.cacheDom();
            this.bindEvents();
            this.setDefaultDate();
            this.loadRecords().then(() => this.applyFilters());
        },

        cacheDom() {
            this.dom = {
                openModalBtn: document.getElementById('btn-open-log-modal'),
                closeModalBtn: document.getElementById('close-log-modal'),
                modal: document.getElementById('log-refund-modal'),
                submitBtn: document.getElementById('btn-submit-refund'),
                tbody: document.getElementById('refunds-tbody'),
                searchInput: document.getElementById('refund-search-input'),
                statusFilter: document.getElementById('refund-status-filter'),
                platformFilter: document.getElementById('refund-platform-filter'),
                reasonFilter: document.getElementById('refund-reason-filter'),
                statPending: document.getElementById('stat-pending'),
                statApproved: document.getElementById('stat-approved'),
                statRestocked: document.getElementById('stat-restocked'),
                statRejected: document.getElementById('stat-rejected')
            };
        },

        bindEvents() {
            if (this.dom.openModalBtn) {
                this.dom.openModalBtn.addEventListener('click', () => {
                    this.resetForm();
                    this.dom.modal.classList.remove('hidden');
                });
            }

            if (this.dom.closeModalBtn) {
                this.dom.closeModalBtn.addEventListener('click', () => this.dom.modal.classList.add('hidden'));
            }

            if (this.dom.modal) {
                this.dom.modal.addEventListener('click', (e) => {
                    if (e.target === e.currentTarget) this.dom.modal.classList.add('hidden');
                });
            }

            if (this.dom.submitBtn) {
                this.dom.submitBtn.addEventListener('click', () => this.submitRefund());
            }

            if (this.dom.searchInput) this.dom.searchInput.addEventListener('input', () => this.applyFilters());
            if (this.dom.statusFilter) this.dom.statusFilter.addEventListener('change', () => this.applyFilters());
            if (this.dom.platformFilter) this.dom.platformFilter.addEventListener('change', () => this.applyFilters());
            if (this.dom.reasonFilter) this.dom.reasonFilter.addEventListener('change', () => this.applyFilters());

            if (this.dom.tbody) {
                this.dom.tbody.addEventListener('click', (event) => {
                    const btn = event.target.closest('button[data-action]');
                    if (!btn) return;
                    const action = btn.dataset.action;
                    const id = btn.dataset.id;
                    if (action === 'approve') this.changeStatus(id, 'Approved');
                    if (action === 'restock') this.changeStatus(id, 'Restocked');
                    if (action === 'reject') this.changeStatus(id, 'Rejected');
                    if (action === 'delete') this.deleteRecord(id);
                });
            }
        },

        setDefaultDate() {
            const today = new Date().toISOString().split('T')[0];
            const dateInput = document.getElementById('refund-date');
            if (dateInput) dateInput.value = today;
        },

        resetForm() {
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('refund-date').value = today;
            document.getElementById('refund-platform').value = '';
            document.getElementById('refund-awb').value = '';
            document.getElementById('refund-order-id').value = '';
            document.getElementById('refund-customer').value = '';
            document.getElementById('refund-reason').value = '';
            document.getElementById('refund-items').value = '';
            document.getElementById('refund-notes').value = '';
            document.getElementById('refund-restock').checked = false;
        },

        async loadRecords() {
            try {
                this.records = await refundStore.getAll();
            } catch (e) {
                console.error('Failed to load refund records', e);
                this.records = [];
            }
        },

        async submitRefund() {
            const date = document.getElementById('refund-date').value.trim();
            const platform = document.getElementById('refund-platform').value;
            const awb = document.getElementById('refund-awb').value.trim();
            const orderId = document.getElementById('refund-order-id').value.trim();
            const customer = document.getElementById('refund-customer').value.trim();
            const reason = document.getElementById('refund-reason').value;
            const items = document.getElementById('refund-items').value.trim();
            const notes = document.getElementById('refund-notes').value.trim();
            const restock = document.getElementById('refund-restock').checked;

            if (!date || !platform || !reason || !items) {
                toast.show('Please fill in Date, Platform, Reason, and Items.', 'error');
                return;
            }

            const record = {
                id: `rfnd-${Date.now()}`,
                date,
                platform,
                awb: awb || '-',
                orderId: orderId || '-',
                customer: customer || '-',
                reason,
                items,
                notes,
                restock,
                status: restock ? 'Restocked' : 'Pending',
                createdAt: new Date().toISOString()
            };

            try {
                await refundStore.save(record);
                this.records.unshift(record);
                this.applyFilters();
                this.dom.modal.classList.add('hidden');
                toast.show('Refund logged successfully.', 'success');
            } catch (e) {
                console.error('Failed to save refund', e);
                toast.show('Failed to save. Please try again.', 'error');
            }
        },

        applyFilters() {
            const search = this.dom.searchInput ? this.dom.searchInput.value.toLowerCase().trim() : '';
            const status = this.dom.statusFilter ? this.dom.statusFilter.value : 'all';
            const platform = this.dom.platformFilter ? this.dom.platformFilter.value : 'all';
            const reason = this.dom.reasonFilter ? this.dom.reasonFilter.value : 'all';

            this.filtered = this.records.filter(r => {
                const matchSearch = !search ||
                    r.awb.toLowerCase().includes(search) ||
                    r.orderId.toLowerCase().includes(search) ||
                    (r.customer && r.customer.toLowerCase().includes(search)) ||
                    r.items.toLowerCase().includes(search);

                const matchStatus = status === 'all' || r.status === status;
                const matchPlatform = platform === 'all' || r.platform === platform;
                const matchReason = reason === 'all' || r.reason === reason;

                return matchSearch && matchStatus && matchPlatform && matchReason;
            });

            this.renderTable();
            this.updateStats();
        },

        updateStats() {
            const counts = { Pending: 0, Approved: 0, Restocked: 0, Rejected: 0 };
            this.records.forEach((r) => {
                if (counts[r.status] !== undefined) counts[r.status]++;
            });
            if (this.dom.statPending) this.dom.statPending.textContent = counts.Pending;
            if (this.dom.statApproved) this.dom.statApproved.textContent = counts.Approved;
            if (this.dom.statRestocked) this.dom.statRestocked.textContent = counts.Restocked;
            if (this.dom.statRejected) this.dom.statRejected.textContent = counts.Rejected;
        },

        renderTable() {
            if (!this.dom.tbody) return;
            this.dom.tbody.innerHTML = '';

            if (this.filtered.length === 0) {
                this.dom.tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:3rem; color:var(--text-secondary);">No refund records found.</td></tr>';
                return;
            }

            this.filtered.forEach((r) => {
                const tr = document.createElement('tr');

                const dateStr = r.date
                    ? new Date(r.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                    : '-';

                const platformBadge = this.platformBadge(r.platform);
                const statusBadge = this.statusBadge(r.status);

                const actionButtons = [];
                if (r.status === 'Pending') {
                    actionButtons.push(`<button class="action-btn btn-approve" data-action="approve" data-id="${r.id}">Approve</button>`);
                    actionButtons.push(`<button class="action-btn btn-restock" data-action="restock" data-id="${r.id}">Restock</button>`);
                    actionButtons.push(`<button class="action-btn btn-reject" data-action="reject" data-id="${r.id}">Reject</button>`);
                } else if (r.status === 'Approved') {
                    actionButtons.push(`<button class="action-btn btn-restock" data-action="restock" data-id="${r.id}">Restock</button>`);
                    actionButtons.push(`<button class="action-btn btn-reject" data-action="reject" data-id="${r.id}">Reject</button>`);
                }
                actionButtons.push(`<button class="action-btn btn-delete" data-action="delete" data-id="${r.id}">Delete</button>`);

                tr.innerHTML = `
                    <td style="color:var(--text-secondary); font-size:0.88rem; white-space:nowrap;">${dateStr}</td>
                    <td>
                        <div style="font-weight:600; font-family:monospace; font-size:0.95rem;">${this.escapeHtml(r.awb)}</div>
                        <div style="color:var(--text-secondary); font-size:0.8rem;">${this.escapeHtml(r.orderId)}</div>
                    </td>
                    <td>${platformBadge}</td>
                    <td style="font-size:0.88rem; color:var(--text-primary);">${this.escapeHtml(r.reason)}</td>
                    <td style="font-size:0.88rem; color:var(--text-secondary);">${this.escapeHtml(r.items)}</td>
                    <td><div class="notes-cell" title="${this.escapeAttr(r.notes || '')}">${r.notes ? this.escapeHtml(r.notes) : '<span style="opacity:0.35;">-</span>'}</div></td>
                    <td>${statusBadge}${r.restock ? ' <span style="font-size:0.75rem; color:var(--text-secondary);">Restock</span>' : ''}</td>
                    <td style="text-align:right; white-space:nowrap;">${actionButtons.join(' ')}</td>
                `;
                this.dom.tbody.appendChild(tr);
            });
        },

        platformBadge(platform) {
            const map = {
                Shopee: 'shopee',
                Lazada: 'lazada',
                Shopify: 'shopify',
                TikTok: 'tiktok',
                B2B: 'b2b',
                Other: 'other'
            };
            const cls = map[platform] || 'other';
            return `<span class="badge ${cls}">${this.escapeHtml(platform || 'Other')}</span>`;
        },

        statusBadge(status) {
            const map = {
                Pending: 'pending',
                Approved: 'approved',
                Restocked: 'restocked',
                Rejected: 'rejected'
            };
            const cls = map[status] || 'pending';
            return `<span class="badge ${cls}">${this.escapeHtml(status)}</span>`;
        },

        async changeStatus(id, newStatus) {
            try {
                await refundStore.update(id, { status: newStatus });
                const rec = this.records.find(r => r.id === id);
                if (rec) rec.status = newStatus;
                this.applyFilters();
                toast.show(`Status updated to ${newStatus}.`, 'success');
            } catch (e) {
                console.error('Failed to update status', e);
                toast.show('Failed to update status.', 'error');
            }
        },

        async deleteRecord(id) {
            if (!confirm('Delete this refund record? This cannot be undone.')) return;
            try {
                await refundStore.remove(id);
                this.records = this.records.filter(r => r.id !== id);
                this.applyFilters();
                toast.show('Refund record deleted.', 'success');
            } catch (e) {
                console.error('Failed to delete refund', e);
                toast.show('Failed to delete record.', 'error');
            }
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
        }
    };

    issueApp.defects = {
        pendingLogs: [],
        resolvedLogs: [],
        currentDefect: null,
        activeFilter: 'all',
        statusFilter: 'all',
        localProducts: {},

        init() {
            this.cacheDom();
            this.bindEvents();
            this.loadLogs();
            this.loadProducts().then(() => {
                this.renderLogs();
                this.updateCounts();
            });
        },

        cacheDom() {
            this.dom = {
                defectButtons: document.querySelectorAll('[data-defect-type]'),
                filterButtons: document.querySelectorAll('[data-defect-filter]'),
                otherContainer: document.getElementById('other-input-container'),
                otherInput: document.getElementById('other-defect-desc'),
                scanInput: document.getElementById('defect-scan-input'),
                batchInput: document.getElementById('defect-batch-input'),
                expiryInput: document.getElementById('defect-expiry-input'),
                feedback: document.getElementById('scan-feedback'),
                logBody: document.getElementById('defect-log-body'),
                searchInput: document.getElementById('defect-search-input'),
                statusFilter: document.getElementById('defect-status-filter'),
                syncBtn: document.getElementById('defect-sync-btn'),
                clearBtn: document.getElementById('defect-clear-btn'),
                countNoAir: document.getElementById('count-no-air'),
                countLeak: document.getElementById('count-leak'),
                countMushy: document.getElementById('count-mushy'),
                countOther: document.getElementById('count-other')
            };
        },

        bindEvents() {
            this.dom.defectButtons.forEach((btn) => {
                btn.addEventListener('click', () => this.selectDefect(btn.dataset.defectType));
            });

            this.dom.filterButtons.forEach((btn) => {
                btn.addEventListener('click', () => this.setFilter(btn.dataset.defectFilter));
            });

            if (this.dom.scanInput) {
                this.dom.scanInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        const barcode = this.dom.scanInput.value.trim();
                        if (barcode) this.processScan(barcode);
                        this.dom.scanInput.value = '';
                    }
                });
            }

            if (this.dom.searchInput) {
                this.dom.searchInput.addEventListener('input', () => this.renderLogs());
            }
            if (this.dom.statusFilter) {
                this.dom.statusFilter.addEventListener('change', () => {
                    this.statusFilter = this.dom.statusFilter.value;
                    this.renderLogs();
                });
            }

            if (this.dom.syncBtn) this.dom.syncBtn.addEventListener('click', () => this.syncToCloud());
            if (this.dom.clearBtn) this.dom.clearBtn.addEventListener('click', () => this.clearAllLogs());

            if (this.dom.logBody) {
                this.dom.logBody.addEventListener('click', (event) => {
                    const btn = event.target.closest('button[data-action]');
                    if (!btn) return;
                    const action = btn.dataset.action;
                    const id = Number(btn.dataset.id);
                    if (action === 'edit') this.editLogItem(id);
                    if (action === 'delete') this.deleteLogItem(id);
                });
            }
        },

        loadLogs() {
            const pendingKey = 'tkg_defect_logs_pending';
            const resolvedKey = 'tkg_defect_logs_resolved';
            const legacyKey = 'tkg_defect_logs';

            const safeParse = (key) => {
                try { return JSON.parse(localStorage.getItem(key) || '[]'); }
                catch { return []; }
            };

            const pending = safeParse(pendingKey);
            const resolved = safeParse(resolvedKey);

            if (pending.length === 0 && resolved.length === 0) {
                const legacy = safeParse(legacyKey);
                if (legacy.length > 0) {
                    this.pendingLogs = legacy.map((log) => ({
                        ...log,
                        status: 'Pending',
                        createdAt: log.createdAt || new Date().toISOString()
                    }));
                    localStorage.removeItem(legacyKey);
                    this.saveLogs();
                    return;
                }
            }

            this.pendingLogs = pending.map((log) => ({
                ...log,
                status: log.status || 'Pending',
                createdAt: log.createdAt || new Date().toISOString()
            }));
            this.resolvedLogs = resolved.map((log) => ({
                ...log,
                status: log.status || 'Resolved',
                createdAt: log.createdAt || new Date().toISOString()
            }));
        },

        saveLogs() {
            localStorage.setItem('tkg_defect_logs_pending', JSON.stringify(this.pendingLogs));
            localStorage.setItem('tkg_defect_logs_resolved', JSON.stringify(this.resolvedLogs));
        },

        async loadProducts() {
            this.localProducts = {};

            if (window.AppDB && typeof window.AppDB.getProducts === 'function') {
                try {
                    const dbProducts = await window.AppDB.getProducts();
                    if (dbProducts && Object.keys(dbProducts).length > 0) {
                        this.localProducts = dbProducts;
                    }
                } catch (e) {
                    console.error('Failed to load native DB catalog', e);
                }
            }

            const saved = localStorage.getItem('tkg_product_overrides');
            if (saved) {
                try {
                    const overrides = JSON.parse(saved);
                    for (const [name, data] of Object.entries(overrides)) {
                        if (data === null) {
                            if (typeof PRODUCT_DB !== 'undefined') delete PRODUCT_DB[name];
                            continue;
                        }
                        if (typeof data === 'object' && data.barcodes && data.barcodes.length > 0) {
                            if (typeof PRODUCT_DB !== 'undefined') PRODUCT_DB[name] = data.barcodes;
                        }
                    }
                } catch (e) {
                    console.error('Failed to load overrides', e);
                }
            }
        },

        selectDefect(type) {
            this.currentDefect = type;

            this.dom.defectButtons.forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.defectType === type);
            });

            if (type === 'other') {
                if (this.dom.otherContainer) this.dom.otherContainer.style.display = 'block';
                if (this.dom.otherInput) this.dom.otherInput.focus();
            } else {
                if (this.dom.otherContainer) this.dom.otherContainer.style.display = 'none';
                if (this.dom.otherInput) this.dom.otherInput.value = '';
            }

            if (this.dom.scanInput) {
                this.dom.scanInput.disabled = false;
                this.dom.scanInput.placeholder = `Scanning for: ${this.formatType(type)}...`;
                if (type !== 'other') this.dom.scanInput.focus();
            }

            if (this.dom.feedback) {
                this.dom.feedback.textContent = `Ready to register ${this.formatType(type)} items`;
                this.dom.feedback.style.color = 'var(--text-primary)';
            }
        },

        setFilter(filter) {
            this.activeFilter = filter;
            this.dom.filterButtons.forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.defectFilter === filter);
            });
            this.renderLogs();
        },

        formatType(type, desc = '') {
            if (type === 'no-air') return 'No Air';
            if (type === 'leak') return 'Leak';
            if (type === 'mushy') return 'Mushy';
            if (type === 'other') return desc || 'Other';
            return type;
        },

        processScan(barcode) {
            if (!this.currentDefect) {
                toast.show('Please select a defect type first.', 'error');
                return;
            }

            const productName = this.findProductByBarcode(barcode);
            const otherDesc = this.dom.otherInput ? this.dom.otherInput.value.trim() : '';
            const batchNum = this.dom.batchInput ? this.dom.batchInput.value.trim() : '';
            const expiryDate = this.dom.expiryInput ? this.dom.expiryInput.value : '';

            const existingEntry = this.pendingLogs.find((l) =>
                l.barcode === barcode &&
                l.type === this.currentDefect &&
                l.batch === batchNum &&
                l.expiry === expiryDate &&
                (this.currentDefect !== 'other' || l.otherDesc === otherDesc)
            );

            if (existingEntry) {
                existingEntry.count++;
                const index = this.pendingLogs.indexOf(existingEntry);
                if (index > -1) {
                    this.pendingLogs.splice(index, 1);
                    this.pendingLogs.unshift(existingEntry);
                }
                this.saveLogs();
                this.renderLogs();
                this.updateCounts();
                const batchText = batchNum ? `[Batch: ${batchNum}] ` : '';
                const expText = expiryDate ? `[Exp: ${expiryDate}]` : '';
                if (this.dom.feedback) {
                    this.dom.feedback.textContent = `Updated: ${productName} (x${existingEntry.count}) - ${this.formatType(this.currentDefect, otherDesc)} ${batchText}${expText}`;
                    this.dom.feedback.style.color = 'var(--accent)';
                }
                return;
            }

            const entry = {
                id: Date.now(),
                product: productName,
                barcode: barcode,
                type: this.currentDefect,
                otherDesc: otherDesc,
                batch: batchNum,
                expiry: expiryDate,
                count: 1,
                status: 'Pending',
                createdAt: new Date().toISOString()
            };

            this.pendingLogs.unshift(entry);
            this.saveLogs();
            this.renderLogs();
            this.updateCounts();

            if (this.dom.feedback) {
                this.dom.feedback.textContent = `Registered: ${productName} (${this.formatType(this.currentDefect, otherDesc)})`;
                this.dom.feedback.style.color = 'var(--success)';
            }
        },

        findProductByBarcode(code) {
            for (const [name, data] of Object.entries(this.localProducts)) {
                if (data && data.barcodes && data.barcodes.includes(code)) return name;
            }

            if (typeof PRODUCT_CATALOG !== 'undefined') {
                for (const category in PRODUCT_CATALOG) {
                    for (const [name, item] of Object.entries(PRODUCT_CATALOG[category])) {
                        if (item.barcodes && item.barcodes.includes(code)) return name;
                    }
                }
            }

            if (typeof PRODUCT_DB !== 'undefined') {
                for (const [name, codes] of Object.entries(PRODUCT_DB)) {
                    if (Array.isArray(codes) && codes.includes(code)) return name;
                }
            }
            return 'Unknown Product';
        },

        getFilteredLogs() {
            const search = this.dom.searchInput ? this.dom.searchInput.value.toLowerCase().trim() : '';
            const status = this.statusFilter === 'all' ? 'all' : this.statusFilter;

            let logs = [];
            if (status === 'Pending') {
                logs = [...this.pendingLogs];
            } else if (status === 'Resolved') {
                logs = [...this.resolvedLogs];
            } else {
                logs = [...this.pendingLogs, ...this.resolvedLogs];
            }

            return logs.filter((log) => {
                const typeMatch = this.activeFilter === 'all' || log.type === this.activeFilter;
                const searchMatch = !search ||
                    (log.product && log.product.toLowerCase().includes(search)) ||
                    (log.barcode && log.barcode.toLowerCase().includes(search)) ||
                    (log.batch && log.batch.toLowerCase().includes(search));
                return typeMatch && searchMatch;
            });
        },

        renderLogs() {
            if (!this.dom.logBody) return;
            const filteredLogs = this.getFilteredLogs();

            if (filteredLogs.length === 0) {
                this.dom.logBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:2rem; color: var(--text-secondary);">No defect logs found.</td></tr>';
                this.updateCounts([]);
                return;
            }

            this.dom.logBody.innerHTML = filteredLogs.map((log) => {
                const batchBadge = log.batch ? `<div style="font-size: 0.8em; color: var(--accent); margin-top: 4px;">Batch: ${this.escapeHtml(log.batch)}</div>` : '';
                const expBadge = log.expiry ? `<div style="font-size: 0.8em; color: var(--danger); margin-top: 4px;">Exp: ${this.escapeHtml(log.expiry)}</div>` : '';
                const statusBadge = this.statusBadge(log.status);
                const actionButtons = [];
                if (log.status === 'Pending') {
                    actionButtons.push(`<button class="action-btn btn-neutral" data-action="edit" data-id="${log.id}">Edit</button>`);
                }
                actionButtons.push(`<button class="action-btn btn-delete" data-action="delete" data-id="${log.id}">Delete</button>`);

                return `
                <tr>
                    <td style="font-weight:600;">
                        ${this.escapeHtml(log.product)}
                        ${log.count > 1 ? `<span style="background:#0f172a; color:white; padding:2px 8px; border-radius:12px; font-size:0.8em; margin-left:8px; display: inline-block;">x${log.count}</span>` : ''}
                    </td>
                    <td><span class="defect-tag defect-${log.type}">${this.escapeHtml(this.formatType(log.type, log.otherDesc))}</span></td>
                    <td>
                        ${batchBadge}
                        ${expBadge}
                        ${!log.batch && !log.expiry ? '<span style="color:var(--text-secondary); font-size:0.8em;">-</span>' : ''}
                    </td>
                    <td style="font-family:monospace; color:var(--text-secondary);">${this.escapeHtml(log.barcode)}</td>
                    <td>${statusBadge}</td>
                    <td>${actionButtons.join(' ')}</td>
                </tr>
            `;
            }).join('');

            this.updateCounts(filteredLogs);
        },

        statusBadge(status) {
            const cls = status === 'Resolved' ? 'resolved' : 'pending';
            return `<span class="badge ${cls}">${this.escapeHtml(status)}</span>`;
        },

        editLogItem(id) {
            const index = this.pendingLogs.findIndex((l) => l.id === id);
            if (index === -1) return;
            const log = this.pendingLogs[index];

            const newBatch = prompt(`Edit Batch Number for ${log.product}\nCurrent Batch: ${log.batch || 'None'}`, log.batch || '');
            if (newBatch === null) return;

            const newExpiry = prompt(`Edit Expiry Date (YYYY-MM-DD)\nCurrent Expiry: ${log.expiry || 'None'}`, log.expiry || '');
            if (newExpiry === null) return;

            log.batch = newBatch.trim();
            log.expiry = newExpiry.trim();

            this.saveLogs();
            this.renderLogs();
        },

        deleteLogItem(id) {
            const pendingIndex = this.pendingLogs.findIndex((l) => l.id === id);
            if (pendingIndex !== -1) {
                this.pendingLogs.splice(pendingIndex, 1);
            } else {
                const resolvedIndex = this.resolvedLogs.findIndex((l) => l.id === id);
                if (resolvedIndex !== -1) this.resolvedLogs.splice(resolvedIndex, 1);
            }
            this.saveLogs();
            this.renderLogs();
        },

        updateCounts(logs = null) {
            const list = logs || this.pendingLogs;
            const counts = { 'no-air': 0, leak: 0, mushy: 0, other: 0 };
            list.forEach((l) => {
                if (counts[l.type] !== undefined) counts[l.type] += l.count;
            });

            if (this.dom.countNoAir) this.dom.countNoAir.textContent = counts['no-air'];
            if (this.dom.countLeak) this.dom.countLeak.textContent = counts.leak;
            if (this.dom.countMushy) this.dom.countMushy.textContent = counts.mushy;
            if (this.dom.countOther) this.dom.countOther.textContent = counts.other;
        },

        async syncToCloud() {
            if (!this.pendingLogs.length) {
                toast.show('No pending defects to sync.', 'error');
                return;
            }
            if (!confirm('Push these defect logs to the Cloud Ledger? This will permanently deduct stock.')) return;
            if (!window.AppDB || typeof window.AppDB.insertDefect !== 'function') {
                toast.show('Cloud sync is unavailable. AppDB is not ready.', 'error');
                return;
            }

            const btn = this.dom.syncBtn;
            const originalText = btn ? btn.textContent : '';
            if (btn) {
                btn.textContent = 'Syncing...';
                btn.disabled = true;
            }

            try {
                for (const log of this.pendingLogs) {
                    await window.AppDB.insertDefect({
                        product: log.product,
                        count: log.count,
                        expiry: log.expiry || null,
                        defectType: log.type,
                        notes: log.otherDesc || ''
                    });
                }

                const resolvedAt = new Date().toISOString();
                const resolvedLogs = this.pendingLogs.map((log) => ({
                    ...log,
                    status: 'Resolved',
                    resolvedAt
                }));

                this.resolvedLogs = resolvedLogs.concat(this.resolvedLogs);
                this.pendingLogs = [];
                this.saveLogs();
                this.renderLogs();
                toast.show('Defects synced to Cloud Ledger.', 'success');
            } catch (e) {
                console.error('Sync failed', e);
                toast.show('Sync failed. Please try again.', 'error');
            } finally {
                if (btn) {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }
            }
        },

        clearAllLogs() {
            if (!confirm('Clear all logs? This will remove pending and resolved defects.')) return;
            this.pendingLogs = [];
            this.resolvedLogs = [];
            localStorage.removeItem('tkg_defect_logs_pending');
            localStorage.removeItem('tkg_defect_logs_resolved');
            this.renderLogs();
            if (this.dom.scanInput) this.dom.scanInput.value = '';
            if (this.dom.feedback) this.dom.feedback.textContent = 'Session cleared';
        },

        escapeHtml(value) {
            return String(value || '').replace(/[&<>"']/g, (char) => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[char]));
        }
    };

    issueApp.init();
    window.issueApp = issueApp;
});
