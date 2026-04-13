/**
* reports.js - TKG Barcode Ops Reports & Statistics
* Handles dynamic inventory counting and burn rate charts.
*/

document.addEventListener('DOMContentLoaded', () => {
    const reportsApp = {
        orders: [],
        inventory: {},
        defects: [],
        productStats: {},
        chartInstance: null,

        async init() {
            // Show loading overlay
            const tbody = document.getElementById('report-tbody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 2rem;">Fetching Live Analytical Data from Supabase...</td></tr>';
            
            await this.loadData();
            this.processData();
            this.bindEvents();
            this.extractProducts();
            this.renderStats();
            this.initChart();
            this.updateChart();
        },

        bindEvents() {
            const prodFilt = document.getElementById('chart-product-filter');
            if (prodFilt) prodFilt.addEventListener('change', () => this.updateChart());
            const timeFilt = document.getElementById('chart-timeframe-filter');
            if (timeFilt) timeFilt.addEventListener('change', () => this.updateChart());
        },

        selectChartProduct(productName) {
            const productSelect = document.getElementById('chart-product-filter');
            if (productSelect) productSelect.value = productName;
            this.updateChart();
            const cs = document.querySelector('.chart-container');
            if (cs) cs.scrollIntoView({ behavior: 'smooth', block: 'center' });
        },

        extractProducts() {
            const productSelect = document.getElementById('chart-product-filter');
            if (!productSelect) return;

            const productNames = Object.keys(this.productStats).sort();
            productNames.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name; // Already formatted during processData
                productSelect.appendChild(opt);
            });
        },

        async loadData() {
            try {
                // 1. Fetch entire historical ledger to build tabular totals
                this.ledger = await window.AppDB.getRawLedger();
                
                // 2. Fetch all orders to build accurate chronological month-charts
                this.orders = await window.AppDB.getOrders();
            } catch (e) {
                console.error("Reports Failed to fetch Supabase data:", e);
                this.ledger = [];
                this.orders = [];
            }
        },

        processData() {
            this.productStats = {};

            const canonName = (n) => {
                if (!n) return 'unknown';
                return window.formatProductName ? window.formatProductName(n).toLowerCase() : String(n).toLowerCase();
            };
            // Helper to initialize a product
            const initProduct = (rawName) => {
                const name = canonName(rawName);
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

            // Build a set of cancelled order IDs
            const cancelledOrderIds = new Set();
            if (Array.isArray(this.orders)) {
                this.orders.forEach(o => {
                     if (o && o.status && String(o.status).toLowerCase() === 'cancelled') {
                         if (o.id) cancelledOrderIds.add(String(o.id));
                     }
                });
            }

            // 1. Fast ledger tabulation
            if (Array.isArray(this.ledger)) {
                this.ledger.forEach(row => {
                    if (!row) return; // safety hook
                    // If this is an OUTBOUND ledger deduction tied to a mathematically Cancelled Order, ignore it.
                    if (row.transaction_type === 'OUTBOUND' && row.reference_id && cancelledOrderIds.has(String(row.reference_id))) {
                        return;
                    }

                    const name = initProduct(row.product_name);
                    if (row.transaction_type === 'INBOUND') this.productStats[name].inbound += row.qty;
                    if (row.transaction_type === 'OUTBOUND') this.productStats[name].outbound += row.qty;
                    if (row.transaction_type === 'DEFECT') this.productStats[name].defects += row.qty;
                    if (row.transaction_type === 'ADJUSTMENT') {
                        if (row.qty > 0) this.productStats[name].inbound += row.qty;
                        else this.productStats[name].outbound += Math.abs(row.qty);
                    }
                });
            }

            // Helper to parse order dates cleanly
            const getOrderDate = (order) => {
                if (order.date) return new Date(order.date);
                if (order.id) {
                    const parts = String(order.id).split('-');
                    if (parts.length > 1) {
                        const ts = parseInt(parts[1]);
                        if (!isNaN(ts)) return new Date(ts);
                    }
                }
                return new Date();
            };

            // 2. Process Outbound (Orders completed or exported) chronologically
            if (Array.isArray(this.orders)) {
                this.orders.forEach(order => {
                    if (!order) return;
                    const isComplete = order.status === 'Complete' || order.status === 'Exported';
                    if (!isComplete) return;

                    const d = getOrderDate(order);
                    const monthKey = d.toLocaleString('default', { month: 'short', year: 'numeric' });

                    if (Array.isArray(order.lineItems)) {
                        order.lineItems.forEach(line => {
                            if (!line) return;
                            if (line.subItems && Array.isArray(line.subItems) && line.subItems.length > 0) {
                                line.subItems.forEach(sub => {
                                    if (!sub) return;
                                    if (sub.scannedBreakdown && Object.keys(sub.scannedBreakdown).length > 0) {
                                        for (const [sNameRaw, sCount] of Object.entries(sub.scannedBreakdown)) {
                                            const name = initProduct(sNameRaw);
                                            if (!this.productStats[name].monthlyOutbound[monthKey]) this.productStats[name].monthlyOutbound[monthKey] = 0;
                                            this.productStats[name].monthlyOutbound[monthKey] += sCount;
                                        }
                                    } else {
                                        const name = initProduct(sub.name);
                                        if (!this.productStats[name].monthlyOutbound[monthKey]) this.productStats[name].monthlyOutbound[monthKey] = 0;
                                        this.productStats[name].monthlyOutbound[monthKey] += (sub.requiredQty || 0);
                                    }
                                });
                            } else {
                                const name = initProduct(line.name);
                                if (!this.productStats[name].monthlyOutbound[monthKey]) this.productStats[name].monthlyOutbound[monthKey] = 0;
                                this.productStats[name].monthlyOutbound[monthKey] += (line.orderedQty || 0);
                            }
                        });
                    }
                });
            }
        },

        renderStats() {
            const tbody = document.getElementById('report-tbody');
            tbody.innerHTML = '';

            let totalOutboundAll = 0;
            let totalDefectsAll = 0;

            const productRows = Object.keys(this.productStats).map(name => {
                const stat = this.productStats[name];
                const dynStock = stat.inbound - stat.outbound - stat.defects;
                totalOutboundAll += stat.outbound;
                totalDefectsAll += stat.defects;

                return {
                    name,
                    ...stat,
                    dynStock
                };
            });

            // Sort by highest outbound
            productRows.sort((a, b) => b.outbound - a.outbound);

            productRows.forEach(row => {
                const tr = document.createElement('tr');
                const lowStockClass = row.dynStock < 10 && row.inbound > 0 ? 'color: var(--danger); font-weight: bold;' : '';

                // Escape quotes for onclick handler safely
                const safeName = row.name.replace(/'/g, "\\'");
                const linkedName = `<a onclick="window.reportsApp.selectChartProduct('${safeName}')" style="cursor: pointer; color: var(--accent); text-decoration: underline; font-weight: 500;">${row.name}</a>`;

                tr.innerHTML = `
                    <td style="font-weight: 600;">${linkedName}</td>
                    <td style="text-align: center; color: var(--success);">${row.inbound}</td>
                    <td style="text-align: center; color: #a855f7;">${row.outbound}</td>
                    <td style="text-align: center; color: var(--danger);">${row.defects}</td>
                    <td style="text-align: center; font-size: 1.1rem; ${lowStockClass}">${row.dynStock}</td>
                `;
                tbody.appendChild(tr);
            });

            document.getElementById('total-outbound-stat').textContent = totalOutboundAll;
            document.getElementById('total-defects-stat').textContent = totalDefectsAll;

            if (productRows.length > 0) {
                document.getElementById('best-seller-stat').textContent = productRows[0].name;
            }
        },

        initChart() {
            const canvasEl = document.getElementById('salesChart');
            if (!canvasEl) return;
            const ctx = canvasEl.getContext('2d');

            Chart.defaults.color = 'rgba(255, 255, 255, 0.7)';
            Chart.defaults.font.family = "'Inter', sans-serif";

            if (this.chartInstance) {
                this.chartInstance.destroy();
            }

            this.chartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Sales Vol (Qty)',
                        data: [],
                        borderColor: '#fbbf24',
                        backgroundColor: 'rgba(251, 191, 36, 0.1)',
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
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleColor: '#fff',
                            bodyColor: '#fbbf24',
                            padding: 10,
                            displayColors: false
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: { precision: 0 },
                            grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false }
                        }
                    }
                }
            });
        },

        updateChart() {
            if (!this.chartInstance) return;

            const productFilter = document.getElementById('chart-product-filter').value;
            const timeframe = document.getElementById('chart-timeframe-filter').value;

            const overlay = document.getElementById('chart-placeholder-overlay');
            const canvasEl = document.getElementById('salesChart');

            if (!productFilter || productFilter === '') {
                if (overlay) overlay.style.display = 'flex';
                if (canvasEl) canvasEl.style.opacity = '0';
                return;
            } else {
                if (overlay) overlay.style.display = 'none';
                if (canvasEl) canvasEl.style.opacity = '1';
            }

            const salesData = {};
            const canonName = (n) => {
                if (!n) return 'unknown';
                return window.formatProductName ? window.formatProductName(n).toLowerCase() : String(n).toLowerCase();
            };

            if (Array.isArray(this.orders)) {
                this.orders.forEach(order => {
                    if (!order) return;
                    const isComplete = order.status === 'Complete' || order.status === 'Exported';
                    if (!isComplete) return;

                    let d = new Date();
                    if (order.date) {
                        d = new Date(order.date);
                    } else if (order.id) {
                        const parts = String(order.id).split('-');
                        if (parts.length > 1) {
                            const ts = parseInt(parts[1]);
                            if (!isNaN(ts)) d = new Date(ts);
                        }
                    }

                    if (isNaN(d.getTime())) return;

                    let dateKey = "";
                    if (timeframe === 'daily') {
                        dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    } else if (timeframe === 'weekly') {
                        const day = d.getDay() || 7;
                        d.setDate(d.getDate() - (day - 1));
                        dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    } else if (timeframe === 'monthly') {
                        dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    } else if (timeframe === 'yearly') {
                        dateKey = `${d.getFullYear()}`;
                    }

                    if (Array.isArray(order.lineItems)) {
                        order.lineItems.forEach(line => {
                            if (!line) return;
                            const isBundle = line.subItems && Array.isArray(line.subItems) && line.subItems.length > 0;
                            const formattedLineName = canonName(line.name);

                            if (isBundle) {
                                // Only tally components to prevent double-counting the parent bundle in "all"
                                line.subItems.forEach(sub => {
                                    if (!sub) return;
                                    const formattedSubName = canonName(sub.name);
                                    if (productFilter === 'all' || formattedSubName === productFilter) {
                                        const qty = sub.requiredQty || 1;
                                        salesData[dateKey] = (salesData[dateKey] || 0) + (qty * (line.orderedQty || 1));
                                    }
                                });
                            } else {
                                // Single item
                                if (productFilter === 'all' || formattedLineName === productFilter) {
                                    salesData[dateKey] = (salesData[dateKey] || 0) + (line.orderedQty || 1);
                                }
                            }
                        });
                    }
                });
            }

            const sortedDates = Object.keys(salesData).sort((a, b) => new Date(a) - new Date(b));
            const dataPoints = sortedDates.map(date => salesData[date]);

            // Formatted name is already in productFilter unless it is 'all'
            const pName = productFilter === 'all' ? 'All Products' : productFilter;
            this.chartInstance.data.datasets[0].label = `${pName} Sales Vol`;

            this.chartInstance.data.labels = timeframe === 'weekly' ? sortedDates.map(d => 'Week of ' + d) : sortedDates;
            this.chartInstance.data.datasets[0].data = dataPoints;
            this.chartInstance.update();
        }
    };

    reportsApp.init();
    window.reportsApp = reportsApp;
});
