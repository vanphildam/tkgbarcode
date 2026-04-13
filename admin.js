/* admin.js */

// --- CORE DATA ENGINE ---
let masterDB = {
    products: {},        // Main library: { name: { barcodes, type, contents, scanRules } }
    mapping: {},         // Shopee/Lazada Name -> Master Name
    settings: {
        darkMode: true
    }
};

const STORAGE_KEY = 'tkg_master_db_v2';

async function loadMasterSystem() {
    try {
        const dbProducts = await window.AppDB.getProducts();

        if (Object.keys(dbProducts).length > 0) {
            masterDB.products = dbProducts;
        } else {
            // Empty DB? Attempt to load legacy JSON mappings as a bridge
            const saved = await window.AppDB.getSetting('tkg_master_db_v2');
            if (saved && saved.products) {
                masterDB.products = saved.products;
                console.log("Loaded legacy products mapping (Requires clicking Sync to migrate to DB).");
            } else {
                ingestLegacyData();
            }
        }

        const savedMap = await window.AppDB.getSetting('tkg_marketplace_mapping');
        if (savedMap) {
            masterDB.mapping = savedMap;
        }

        // Safety Patches
        injectRequestedLinks();
        performOneTimeVariantMigration();

        switchSection('inventory');
    } catch (e) {
        console.error("Failed to load master db", e);
        switchSection('inventory');
    }
}

function injectRequestedLinks() {
    if (!masterDB.mapping) masterDB.mapping = {};

    // List of old, incomplete mappings to remove
    const oldToDelete = [
        "The Kettle Gourmet Minions Popcorn 80g - Cheese / Chocolate / Kaya Butter Toast",
        "The Kettle Gourmet Bronys Brownie Crisps (108g) Chocolate Chip / Banana Fritter / Peanut Pancake Flavour"
    ];
    oldToDelete.forEach(k => delete masterDB.mapping[k]);

    const requested = {
        // Minions Variations
        "The Kettle Gourmet Minions Popcorn 80g - Cheese / Chocolate / Kaya Butter Toast Cheese": "minions holy cheese",
        "The Kettle Gourmet Minions Popcorn 80g - Cheese / Chocolate / Kaya Butter Toast Chocolate": "minions chocolate",
        "The Kettle Gourmet Minions Popcorn 80g - Cheese / Chocolate / Kaya Butter Toast Kaya Butter Toast": "minions kaya butter toast",

        // Brony's Variations
        "The Kettle Gourmet Bronys Brownie Crisps (108g) Chocolate Chip / Banana Fritter / Peanut Pancake Flavour Chocolate Chip": "brony chocolate chip",
        "The Kettle Gourmet Bronys Brownie Crisps (108g) Chocolate Chip / Banana Fritter / Peanut Pancake Flavour Banana Fritter": "brony banana fritter",
        "The Kettle Gourmet Bronys Brownie Crisps (108g) Chocolate Chip / Banana Fritter / Peanut Pancake Flavour Peanut Pancake": "brony peanut pancake",

        // Bundles
        "The Kettle Gourmet 12 + 2 Bundle Set (14 x 65g)": "the kettle gourmet 12 + 2 bundle set (14 x 65g)"
    };

    let added = 0;
    for (const [raw, master] of Object.entries(requested)) {
        if (!masterDB.mapping[raw]) {
            masterDB.mapping[raw] = master;
            added++;
        }
    }

    if (added > 0 || oldToDelete.some(k => k)) {
        console.log(`Updated marketplace mappings.`);
        saveMasterSystem();
    }
}

async function saveMasterSystem() {
    try {
        // Individual product saves are handled directly now.
        // This acts as a wrapper for mappings.
        await window.AppDB.setSetting('tkg_marketplace_mapping', masterDB.mapping || {});
    } catch (e) {
        console.error("Failed to save master db mappings", e);
    }
}

function performOneTimeVariantMigration() {
    if (masterDB.settings && masterDB.settings.variantMigrationDone) return;

    let modified = false;

    const rules = [
        { regex: /brownie crisps \(35g\)/i, parent: 'Brownie Crisps 35g' },
        { regex: /brownie crisps \(108g\)/i, parent: 'Brownie Crisps 108g' },
        { regex: /30g/i, parent: 'Popcorn 30g' },
        { regex: /65g/i, parent: 'Popcorn 65g' },
        { regex: /corn curls/i, parent: 'Yumi Corn Curls' },
        { regex: /corn stick/i, parent: 'Yumi Corn Sticks' },
        { regex: /minions?(?!.*giftbox)/i, parent: 'Minions Popcorn' },
        { regex: /^poppa/i, parent: 'Poppa Popcorn' }
    ];

    Object.values(masterDB.products).forEach(p => {
        // Skip bundles, giftboxes, or if it already has a baseProduct
        if (p.type !== 'single' || p.baseProduct) return;

        for (const rule of rules) {
            // Don't auto-assign the parent to itself
            if (p.name === rule.parent) continue;

            if (rule.regex.test(p.name)) {
                if (!masterDB.products[rule.parent]) {
                    masterDB.products[rule.parent] = {
                        name: rule.parent,
                        type: 'single',
                        barcodes: [],
                        baseProduct: '',
                        contents: [],
                        requireInnerScan: false
                    };
                }
                p.baseProduct = rule.parent;
                modified = true;
                break;
            }
        }
    });

    if (modified) {
        if (!masterDB.settings) masterDB.settings = {};
        masterDB.settings.variantMigrationDone = true;
        saveMasterSystem();
        console.log("Successfully migrated flat products to Variant Architecture");
    }
}

// --- DATA INGESTION (OLD TO NEW) ---
function ingestLegacyData() {
    console.log("Injesting legacy data into Master DB...");
    const db = (typeof PRODUCT_DB !== 'undefined') ? PRODUCT_DB : {};
    const bdb = (typeof BUNDLE_DB !== 'undefined') ? BUNDLE_DB : {};
    const gdb = (typeof GIFTBOX_DB !== 'undefined') ? GIFTBOX_DB : new Set();
    const idb = (typeof IMAGE_DB !== 'undefined') ? IMAGE_DB : {};

    // 1. Process Singles
    for (const [name, codes] of Object.entries(db)) {
        masterDB.products[name] = {
            name: name,
            barcodes: Array.isArray(codes) ? codes : [],
            type: gdb.has(name) ? 'giftbox' : 'single',
            contents: [],
            requireInnerScan: false,
            image: idb[name] || ""
        };
    }

    // 2. Process Bundles/Gift Boxes
    for (const [name, items] of Object.entries(bdb)) {
        let type = name.toLowerCase().includes('gift') ? 'giftbox' : 'bundle';
        if (gdb.has(name)) type = 'giftbox';

        masterDB.products[name] = {
            name: name,
            barcodes: db[name] || [],
            type: type,
            contents: items,
            requireInnerScan: (type === 'giftbox'),
            image: idb[name] || ""
        };
    }

    saveMasterSystem();
}

// --- UI NAVIGATION ---
function switchSection(section) {
    const content = document.getElementById('dynamic-content');
    const title = document.getElementById('section-title');

    // Update Sidebar Active state
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.remove('active');
        if (btn.innerText.toLowerCase().includes(section)) btn.classList.add('active');
    });

    if (section === 'inventory') {
        title.innerText = "Master Inventory";
        renderInventory();
    } else if (section === 'giftboxes') {
        title.innerText = "Gift Box Recipes";
        renderRecipes();
    } else if (section === 'mapping') {
        title.innerText = "Marketplace Links";
        renderMapping();
    } else if (section === 'scanner') {
        title.innerText = "Marketplace Scanner";
        renderScanner();
    } else if (section === 'backups') {
        title.innerText = "Backups & Data Control";
        renderBackups();
    }
}

// --- INVENTORY VIEW ---
window.toggleVariantGroup = function (btnId, containerId, event) {
    event.stopPropagation();
    const container = document.getElementById(containerId);
    if (!container) return;
    const isHidden = container.style.display === 'none';
    container.style.display = isHidden ? 'flex' : 'none';
    document.getElementById(btnId).innerText = isHidden ? '▼ Hide Variants' : '▶ Show Variants';
};

function renderInventory() {
    const content = document.getElementById('dynamic-content');

    const parents = [];
    const standalone = [];
    const childrenMap = {};

    Object.values(masterDB.products).sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
        if (p.type === 'single' && p.baseProduct && masterDB.products[p.baseProduct]) {
            if (!childrenMap[p.baseProduct]) childrenMap[p.baseProduct] = [];
            childrenMap[p.baseProduct].push(p);
        } else {
            standalone.push(p);
        }
    });

    standalone.forEach(p => {
        if (childrenMap[p.name]) {
            parents.push({ parent: p, children: childrenMap[p.name] });
        } else {
            parents.push({ parent: p, children: [] });
        }
    });

    content.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:1.5rem;">
            ${parents.map((group, gIdx) => `
                <div style="background:var(--bg-card); border-radius:12px; border: 1px solid var(--border); overflow:hidden; transition: all 0.2s;">
                    <!-- Parent Row -->
                    <div class="p-card" style="margin:0; border:none; border-bottom: ${group.children.length > 0 ? '1px solid var(--border)' : 'none'}; border-radius:0; background:rgba(0,0,0,0.2); display: flex; align-items: center; gap: 1rem;" onclick="editProduct('${group.parent.name.replace(/'/g, "\\'")}')">
                        <div style="width: 50px; height: 50px; border-radius: 8px; background: rgba(255,255,255,0.05); overflow: hidden; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); flex-shrink:0;">
                            ${group.parent.image ? `<img src="${group.parent.image}" style="width: 100%; height: 100%; object-fit: cover;">` : `<span style="font-size: 1.2rem; opacity: 0.3;">📦</span>`}
                        </div>
                        <div style="flex:1;">
                            <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 0.25rem;">${group.parent.name}</div>
                            <div style="color: var(--text-secondary); font-size: 0.85rem;">
                                ${group.children.length > 0 ? `<b style="color:var(--accent);">${group.children.length} Variants Selected</b> | ` : ''} 
                                ${group.parent.barcodes.length > 0 ? group.parent.barcodes.join(', ') : 'No Barcode'}
                            </div>
                        </div>
                        <div style="display:flex; align-items:center; gap: 1rem;">
                            <span class="tag tag-${group.parent.type}">${group.parent.type}</span>
                            ${group.children.length > 0 ? `
                                <button id="btn-grp-${gIdx}" onclick="window.toggleVariantGroup('btn-grp-${gIdx}', 'grp-${gIdx}', event)" style="background:var(--primary); color:white; border:none; padding:0.5rem 1rem; border-radius:6px; cursor:pointer; font-weight:600; font-size:0.8rem; min-width: 130px;">▶ Show Variants</button>
                            ` : ''}
                        </div>
                    </div>
                    
                    <!-- Variants Container -->
                    ${group.children.length > 0 ? `
                        <div id="grp-${gIdx}" style="display:none; flex-direction:column; background:rgba(255,255,255,0.01); padding: 1rem 2rem; gap: 0.75rem;">
                            ${group.children.map(child => `
                                <div style="display:flex; justify-content:space-between; align-items:center; padding: 0.75rem 1rem; background:rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius:8px; cursor:pointer;" onclick="editProduct('${child.name.replace(/'/g, "\\'")}')">
                                    <div style="display:flex; align-items:center; gap: 1rem;">
                                        <div style="width: 35px; height: 35px; border-radius: 6px; background: rgba(255,255,255,0.05); overflow: hidden; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); flex-shrink:0;">
                                            ${child.image ? `<img src="${child.image}" style="width: 100%; height: 100%; object-fit: cover;">` : `<span style="font-size: 0.9rem; opacity: 0.3;">📦</span>`}
                                        </div>
                                        <div>
                                            <div style="font-weight: 600; color:var(--accent);">${child.name}</div>
                                            <div style="font-size:0.8rem; color:var(--text-secondary);">${child.barcodes.length > 0 ? child.barcodes.join(', ') : 'No Barcode'}</div>
                                        </div>
                                    </div>
                                    <span class="tag tag-single" style="font-size:0.7rem; background:rgba(255,255,255,0.1); color:var(--text-secondary);">Variant</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        </div>
    `;
}

// --- RECIPE VIEW ---
function renderRecipes() {
    const content = document.getElementById('dynamic-content');
    const recipes = Object.values(masterDB.products).filter(p => p.type !== 'single');

    content.innerHTML = `
        <div class="inventory-grid">
            ${recipes.map(p => `
                <div class="p-card" onclick="editProduct('${p.name.replace(/'/g, "\\'")}')">
                    <div>
                        <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 0.25rem;">${p.name}</div>
                        <div style="color: var(--text-secondary); font-size: 0.85rem;">${p.contents.length} items configured</div>
                    </div>
                    <div>
                        <span class="tag tag-${p.type}">${p.type}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// --- MAPPING VIEW (THE NEW LINKER) ---
function renderMapping() {
    const content = document.getElementById('dynamic-content');
    const existingLinks = Object.entries(masterDB.mapping || {}).sort((a, b) => a[0].localeCompare(b[0]));

    content.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
            <div style="background: var(--bg-card); padding: 2rem; border-radius: 12px; border: 1px solid var(--border);">
                <h2 style="margin-bottom: 1rem;">🔗 Marketplace Name Linker</h2>
                <p style="color: var(--text-secondary); margin-bottom: 2rem;">Link a marketplace name to a Master Product.</p>
                
                <div style="display: flex; flex-direction: column; gap: 1rem;">
                    <label style="font-size: 0.9rem; font-weight: 600;">Marketplace Name (Messy Name)</label>
                    <input type="text" id="map-raw" class="form-control" style="background: rgba(0,0,0,0.2); border: 1px solid var(--border); padding: 1rem; color: white; border-radius: 8px;">
                    
                    <label style="font-size: 0.9rem; font-weight: 600;">Link to Master Product</label>
                    <select id="map-master" class="form-control" style="background: rgba(0,0,0,0.2); border: 1px solid var(--border); padding: 1rem; color: white; border-radius: 8px;">
                        ${Object.keys(masterDB.products).sort().map(name => `<option value="${name}">${name}</option>`).join('')}
                    </select>
                    
                    <button class="btn btn-primary" style="margin-top: 1rem; padding: 1rem;" onclick="saveMapping()">Create Link</button>
                </div>
            </div>

            <div style="background: var(--bg-card); padding: 2rem; border-radius: 12px; border: 1px solid var(--border); overflow-y:auto; max-height:80vh;">
                <h3 style="margin-bottom:1rem;">Current Active Links (${existingLinks.length})</h3>
                ${existingLinks.map(([raw, master]) => `
                    <div style="padding: 0.75rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem;">
                        <span style="color: var(--text-secondary); max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${raw}</span>
                        <span style="color: var(--accent); font-weight: 600;">⮕ ${master}</span>
                        <button onclick="deleteMapping('${raw.replace(/'/g, "\\'")}')" style="background:none; border:none; color:var(--danger); cursor:pointer;">✕</button>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function saveMapping() {
    const raw = document.getElementById('map-raw').value.trim();
    const master = document.getElementById('map-master').value;
    if (!raw || !master) return alert("Both names are required");

    if (!masterDB.mapping) masterDB.mapping = {};
    masterDB.mapping[raw] = master;
    saveMasterSystem();
    renderMapping();
}

function deleteMapping(raw) {
    if (confirm(`Remove link for "${raw}"?`)) {
        delete masterDB.mapping[raw];
        saveMasterSystem();
        renderMapping();
    }
}

// --- MARKETPLACE SCANNER (THE NEW PAGE) ---
function renderScanner() {
    const content = document.getElementById('dynamic-content');
    content.innerHTML = `
        <div style="max-width: 800px; margin: 0 auto; background: var(--bg-card); padding: 3rem; border-radius: 12px; border: 2px dashed var(--accent); text-align: center;">
            <div style="font-size: 3rem; margin-bottom: 1.5rem;">🔍</div>
            <h2 style="margin-bottom: 1rem;">Excel Missing-Product Scanner</h2>
            <p style="color: var(--text-secondary); margin-bottom: 2.5rem;">Upload a Shopee or Lazada export. This tool will extract every product name and tell you which ones aren't in your Master DB yet.</p>
            
            <input type="file" id="scanner-file" style="display:none" onchange="handleScannerUpload(event)">
            <button class="btn btn-primary" style="padding: 1rem 3rem; font-size: 1.1rem; margin: 0 auto;" onclick="document.getElementById('scanner-file').click()">Select Excel File to Scan</button>
            <div style="margin-top: 1.5rem;">
                <button class="btn btn-secondary" style="font-size: 0.8rem; opacity: 0.7;" onclick="injectRequestedLinks(); alert('Requested links have been injected!'); renderScanner();">🛠️ Force Inject Missing Links</button>
            </div>
            <div id="scanner-results" style="margin-top: 3rem; text-align: left;"></div>
        </div>
    `;
}

function handleScannerUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet);

        // Find headers for product names (heuristic)
        const keys = rows.length > 0 ? Object.keys(rows[0]) : [];
        const nameKey = keys.find(k => /product.*name|item.*name|description/i.test(k));
        const variantKey = keys.find(k => /variation/i.test(k));

        if (!nameKey) return alert("Could not find a 'Product Name' column in this file.");

        const foundNames = new Set();
        rows.forEach(row => {
            let full = String(row[nameKey]).trim();
            if (variantKey && row[variantKey]) {
                const v = String(row[variantKey]).trim();
                if (v && !full.includes(v)) full = `${full} ${v}`;
            }
            if (full) foundNames.add(full);
        });

        const unmapped = [...foundNames].filter(name => {
            // Check mapping table first
            if (masterDB.mapping && masterDB.mapping[name]) return false;
            // Check direct master product match
            if (masterDB.products[name]) return false;
            return true;
        });

        renderUnmappedResults(unmapped);
    };
    reader.readAsArrayBuffer(file);
}

function renderUnmappedResults(list) {
    const container = document.getElementById('scanner-results');
    if (list.length === 0) {
        container.innerHTML = `<div style="padding: 2rem; background: var(--success); color: white; border-radius: 8px;">🎉 Perfect! Every single product in this file is already correctly mapped!</div>`;
        return;
    }

    container.innerHTML = `
        <h3 style="margin-bottom: 1.5rem; color: var(--danger);">Found ${list.length} Unmapped Products:</h3>
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            ${list.map(name => `
                <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 0.9rem; color: var(--text-secondary); max-width: 70%;">${name}</span>
                    <button class="btn btn-secondary" onclick="quickLink('${name.replace(/'/g, "\\'")}')">🔗 Link to Master</button>
                </div>
            `).join('')}
        </div>
    `;
}

function quickLink(name) {
    switchSection('mapping');
    document.getElementById('map-raw').value = name;
    document.getElementById('map-raw').focus();
}

// --- BACKUP VIEW ---
function renderBackups() {
    const content = document.getElementById('dynamic-content');
    content.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
            <div style="background: var(--bg-card); padding: 2rem; border-radius: 12px; border: 1px solid var(--border);">
                <h3>📤 Export Master Backup</h3>
                <p style="color: var(--text-secondary); margin: 1rem 0;">Download everything (Products, Recipes, and Links) as a single JSON file for safety.</p>
                <button class="btn btn-primary" onclick="exportBackup()">Download Backup</button>
            </div>
            
            <div style="background: var(--bg-card); padding: 2rem; border-radius: 12px; border: 1px solid var(--border);">
                <h3>📥 Restore System</h3>
                <p style="color: var(--text-secondary); margin: 1rem 0;">Upload a backup file to restore your entire warehouse system to a previous state.</p>
                <input type="file" id="backup-file" style="display:none" onchange="importBackup(event)">
                <button class="btn btn-secondary" onclick="document.getElementById('backup-file').click()">Select File & Restore</button>
            </div>

            <div style="background: var(--bg-card); padding: 2rem; border-radius: 12px; border: 1px solid var(--border); grid-column: span 2;">
                <h3>🛠️ Bulk Maintenance & Migration</h3>
                <p style="color: var(--text-secondary); margin: 1rem 0;">Perform bulk updates and cloud synchronizations directly to your system architecture.</p>
                
                <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                    <button class="btn btn-primary" style="background:#8b5cf6" onclick="applyStandardRecipe()">📦 Assort Standard 8-Pack strictly to All Gift Boxes</button>
                    
                    <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid #3b82f6; padding: 1rem; border-radius: 8px; width: 100%;">
                        <label style="display: block; font-weight: bold; margin-bottom: 0.5rem; color: #3b82f6;">☁️ Step 1: Select your Local "images" Folder here:</label>
                        <input type="file" id="bulk-image-picker" webkitdirectory directory multiple style="display: block; width: 100%; border: 1px dashed #3b82f6; padding: 1rem; background: rgba(0,0,0,0.3); border-radius: 8px; cursor: pointer;" onchange="uploadAllLocalImagesToSupabase(event)">
                        <p style="margin-top: 0.5rem; font-size: 0.8rem; color: var(--text-secondary);">The system will automatically find all standard images in the folder you select, upload them into Supabase, and connect them.</p>
                    </div>
                </div>
            </div>

            <div style="background: var(--bg-card); padding: 2rem; border-radius: 12px; border: 1px solid var(--danger); grid-column: span 2;">
                <h3 style="color: var(--danger)">⚠️ Clean & Consolidate Ledger Database</h3>
                <p style="color: var(--text-secondary); margin: 1rem 0;">This will calculate the live sum for every product, delete the thousands of individual historical log rows from the database, and replace them with a clean "Balance Forward" row. <b>This permanently erases the timestamps of when exact items were logged in the ledger!</b></p>
                <button class="btn btn-primary" style="background:var(--danger)" onclick="executeLedgerRollup()">Wipe History & Consolidate Live Sums</button>
            </div>
        </div>
    `;
}

async function executeLedgerRollup() {
    if (!confirm("WARNING: This will permanently delete your individual stock ledger transaction history from Supabase and replace it with a single consolidated sum for each product. The original Orders and Defect forms will be untouched, but the stock transaction logs will be cleared. Are you absolutely sure?")) return;

    // Quick double check
    if (!confirm("Double checking: Are you 100% sure you want to run the Ledger Roll-up?")) return;

    try {
        const btn = event.target;
        const originalText = btn.innerText;
        btn.innerText = "Processing... Please wait.";
        btn.disabled = true;

        await window.AppDB.consolidateLedger();

        alert("Success! The Ledger database has been cleaned and consolidated.");
        btn.innerText = originalText;
        btn.disabled = false;
    } catch (e) {
        alert("Failed to roll-up ledger: " + e.message);
        console.error(e);
        if (event && event.target) {
            event.target.innerText = "Error - Try Again";
            event.target.disabled = false;
        }
    }
}

function exportBackup() {
    const data = JSON.stringify(masterDB, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tkg_master_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
}

// --- MODAL & EDITING ---
function openNewProductModal() {
    showModal("Create New Product", renderProductForm());
}

function editProduct(name) {
    const product = masterDB.products[name];
    if (!product) return;

    // Load existing contents into the temporary builder state
    tempRecipe = product.contents ? JSON.parse(JSON.stringify(product.contents)) : [];

    showModal(`Edit: ${name}`, renderProductForm(product));

    // Trigger the visual list render
    renderRecipeItems();
}

let selectedImageFile = null;

function handleImageSelection(event) {
    const file = event.target.files[0];
    if (!file) return;

    selectedImageFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        const preview = document.getElementById('p-image-preview');
        if (preview) {
            preview.src = e.target.result;
            preview.style.display = 'block';
            const placeholder = document.getElementById('p-image-placeholder');
            if (placeholder) placeholder.style.display = 'none';
        }
    };
    reader.readAsDataURL(file);
}

function showModal(title, html) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-container').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-container').style.display = 'none';
}

function renderProductForm(p = null) {
    selectedImageFile = null; // Reset on open
    return `
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            <input type="hidden" id="old-name" value="${p ? p.name : ''}">

            <div style="display: flex; gap: 1.5rem; align-items: flex-start;">
                <!-- Image Upload Section -->
                <div style="flex: 0 0 150px;">
                    <label style="display:block; margin-bottom:0.5rem; font-weight:600;">Product Image</label>
                    <div id="image-upload-area" onclick="document.getElementById('p-image-input').click()" style="width:150px; height:150px; border:2px dashed var(--border); border-radius:12px; display:flex; align-items:center; justify-content:center; cursor:pointer; overflow:hidden; background:rgba(0,0,0,0.2); position:relative;">
                        ${p && p.image ? 
                            `<img id="p-image-preview" src="${p.image}" style="width:100%; height:100%; object-fit:cover;">` : 
                            `<div id="p-image-placeholder" style="font-size:2rem; opacity:0.3;">📷</div>
                             <img id="p-image-preview" style="width:100%; height:100%; object-fit:cover; display:none;">`
                        }
                    </div>
                    <input type="file" id="p-image-input" style="display:none;" accept="image/*" onchange="handleImageSelection(event)">
                    <p style="font-size:0.7rem; color:var(--text-secondary); margin-top:0.5rem; text-align:center;">Click to upload</p>
                </div>

                <!-- Basic Info Section -->
                <div style="flex: 1; display: flex; flex-direction: column; gap: 1rem;">
                    <div class="form-group">
                        <label style="display:block; margin-bottom:0.5rem; font-weight:600;">Product Type</label>
                        <select id="p-type" class="form-control" style="width:100%; padding:0.75rem; border-radius:8px; background:#0f172a; border:1px solid var(--border); color:white;" onchange="toggleRecipeFields(this.value)">
                            <option value="single" ${p && p.type === 'single' ? 'selected' : ''}>Single Item</option>
                            <option value="bundle" ${p && p.type === 'bundle' ? 'selected' : ''}>Bundle</option>
                            <option value="giftbox" ${p && p.type === 'giftbox' ? 'selected' : ''}>Gift Box</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label style="display:block; margin-bottom:0.5rem; font-weight:600;">Full Product Name</label>
                        <input type="text" id="p-name" class="form-control" style="width:100%; padding:0.75rem; border-radius:8px; background:#0f172a; border:1px solid var(--border); color:white;" value="${p ? p.name : ''}" placeholder="e.g. Salted Caramel 65g">
                    </div>
                </div>
            </div>

            <div class="form-group" id="variant-group" style="display:${p && p.type !== 'single' ? 'none' : 'block'};">
                <label style="display:block; margin-bottom:0.5rem; font-weight:600;">Is this a Custom Variant of a Parent Product?</label>
                <select id="p-base" class="form-control" style="width:100%; padding:0.75rem; border-radius:8px; background:#0f172a; border:1px solid var(--border); color:white;">
                    <option value="">No (This is a Standalone / Parent Product)</option>
                    ${Object.values(masterDB.products)
            .filter(prod => prod.type === 'single' && !prod.baseProduct && (!p || prod.name !== p.name))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(prod => `<option value="${prod.name}" ${p && p.baseProduct === prod.name ? 'selected' : ''}>Yes, variant of: ${prod.name}</option>`)
            .join('')}
                </select>
            </div>

            <div class="form-group">
                <label style="display:block; margin-bottom:0.5rem; font-weight:600;">Barcodes (Comma separated)</label>
                <input type="text" id="p-codes" class="form-control" style="width:100%; padding:0.75rem; border-radius:8px; background:#0f172a; border:1px solid var(--border); color:white;" value="${p ? (p.barcodes || []).join(', ') : ''}" placeholder="e.g. 796548..., 793591...">
            </div>

            <div id="recipe-fields" style="display:${p && p.type !== 'single' ? 'block' : 'none'}; border:1px solid var(--accent); padding:1rem; border-radius:8px; background:rgba(59, 130, 246, 0.05);">
                <label style="display:block; margin-bottom:0.5rem; font-weight:600; color:var(--accent);">Recipe Contents (Visual Builder)</label>
                
                <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
                    <input type="text" id="recipe-search" placeholder="Search item to add..." style="flex: 2; padding: 0.5rem; border-radius: 6px; background: #0f172a; border: 1px solid var(--border); color: white;" list="master-item-list">
                    <input type="number" id="recipe-qty" value="1" style="width: 60px; padding: 0.5rem; border-radius: 6px; background: #0f172a; border: 1px solid var(--border); color: white;">
                    <button class="btn btn-primary" onclick="addRecipeItem()">+ Add</button>
                </div>

                <div id="visual-recipe-list" style="max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem;">
                    <!-- Recipe items injected here -->
                </div>
                
                <div style="margin-top:1.5rem; display:flex; align-items:center; gap:0.75rem; border-top: 1px solid var(--border); padding-top: 1rem;">
                    <input type="checkbox" id="p-inner-scan" ${p && p.requireInnerScan ? 'checked' : ''} style="width:18px; height:18px;">
                    <label for="p-inner-scan" style="font-size:0.9rem;">Require Individual Item Scan inside this set?</label>
                </div>
            </div>

            <datalist id="master-item-list">
                ${Object.keys(masterDB.products).sort().map(n => `<option value="${n}">`).join('')}
            </datalist>

            <div style="display:flex; gap:1rem; margin-top:1rem;">
                <button class="btn btn-primary" style="flex:1; padding:1rem;" onclick="handleSaveProduct()">Save Product Settings</button>
                <button class="btn btn-secondary" style="padding:1rem;" onclick="closeModal()">Cancel</button>
            </div>
        </div>
    `;
}

function toggleRecipeFields(type) {
    document.getElementById('recipe-fields').style.display = (type === 'single') ? 'none' : 'block';
    const vgroup = document.getElementById('variant-group');
    if (vgroup) vgroup.style.display = (type === 'single') ? 'block' : 'none';
}

// --- VISUAL RECIPE HANDLERS ---
let tempRecipe = [];

function addRecipeItem() {
    const name = document.getElementById('recipe-search').value.trim();
    const qty = parseInt(document.getElementById('recipe-qty').value) || 1;
    if (!name) return;

    // Resolve barcodes if possible for the app
    const masterItem = masterDB.products[name];
    const barcodes = masterItem ? masterItem.barcodes : [];

    tempRecipe.push({ name, count: qty, barcodes: barcodes });
    renderRecipeItems();
    document.getElementById('recipe-search').value = '';
    document.getElementById('recipe-qty').value = 1;
}

function removeRecipeItem(idx) {
    tempRecipe.splice(idx, 1);
    renderRecipeItems();
}

function renderRecipeItems() {
    const list = document.getElementById('visual-recipe-list');
    if (!list) return;
    list.innerHTML = tempRecipe.map((item, idx) => `
        <div style="display: flex; justify-content: space-between; align-items: center; background: #0f172a; padding: 0.5rem; border-radius: 6px; border: 1px solid var(--border);">
            <span style="font-size:0.9rem;">${item.name} <b style="color:var(--accent); margin-left:0.5rem;">x${item.count}</b></span>
            <button onclick="removeRecipeItem(${idx})" style="background:none; border:none; color:var(--danger); cursor:pointer;">✕</button>
        </div>
    `).join('');
}

async function handleSaveProduct() {
    const oldName = document.getElementById('old-name').value;
    const name = document.getElementById('p-name').value.trim();
    const type = document.getElementById('p-type').value;
    const barcodes = document.getElementById('p-codes').value.split(',').map(c => c.trim()).filter(c => c);
    const requireInner = document.getElementById('p-inner-scan').checked;
    const baseProductNode = document.getElementById('p-base');
    const baseProduct = baseProductNode && type === 'single' ? baseProductNode.value : "";

    if (!name) return alert("Name is required");

    const btn = window.event ? window.event.target : document.querySelector('.btn-primary');
    const originalText = btn ? btn.innerText : "Save Product Settings";
    if (btn) {
        btn.innerText = "Saving...";
        btn.disabled = true;
    }

    try {
        let imageUrl = masterDB.products[oldName] ? masterDB.products[oldName].image : "";

        // Handle Image Upload if selected
        if (selectedImageFile) {
            imageUrl = await window.AppDB.uploadProductImage(selectedImageFile, name);
        }

        const productObj = {
            name,
            type,
            barcodes,
            baseProduct,
            image: imageUrl,
            contents: type === 'single' ? [] : [...tempRecipe],
            requireInnerScan: (type === 'giftbox') ? requireInner : false
        };

        // Update Master Data state
        if (oldName && oldName !== name) {
            // Supabase delete isn't strictly necessary immediately, but we overwrite memory
            delete masterDB.products[oldName];
        }

        masterDB.products[name] = productObj;

        // Ensure this single edit is immediately pushed to the DB
        await window.AppDB.saveProduct(productObj);
        
        await saveMasterSystem();
        closeModal();
        renderInventory();
        if (type !== 'single') renderRecipes();
    } catch (e) {
        alert("Failed to save product: " + e.message);
        console.error(e);
    } finally {
        if (btn) {
            btn.innerText = originalText;
            btn.disabled = false;
        }
    }
}

// --- SYNC ENGINE (MAKING IT GO LIVE) ---
async function syncToApp() {
    if (!confirm("This will migrate and push ALL Master Admin products natively to the public.products Database Table for live updates. Proceed?")) return;

    const btn = window.event ? window.event.target : document.querySelector('[onclick="syncToApp()"]');
    const ogText = btn ? btn.innerText : 'Sync to App';
    if(btn) btn.innerText = "Syncing... Please wait";

    try {
        // 1. Bulk push Products to actual DB table
        const total = Object.values(masterDB.products).length;
        let count = 0;
        for (const p of Object.values(masterDB.products)) {
            await window.AppDB.saveProduct(p);
            count++;
        }

        // 2. Sync Marketplace Links
        await window.AppDB.setSetting('tkg_marketplace_mapping', masterDB.mapping || {});
        
        alert(`🚀 Native Database Sync Complete!\nSuccessfully configured ${count} products in the Cloud Database.`);
    } catch (e) {
        alert("Failed to sync to database: " + e.message);
    } finally {
        if(btn) btn.innerText = ogText;
    }
}

// --- BULK TOOLS ---
function applyStandardRecipe() {
    if (!confirm("Are you sure? This will overwrite the contents of EVERY Gift Box with the standard 8 popcorn flavors.")) return;

    const active30g = [
        "chocolate 30g", "kaya butter toast 30g", "nasi lemak 30g",
        "pulut hitam 30g", "salted caramel 30g", "chilli crab 30g",
        "holy cheese 30g", "chicken floss 30g"
    ];

    const standardContents = active30g.map(name => {
        const p = masterDB.products[name];
        return {
            name: name,
            count: 1,
            barcodes: p ? p.barcodes : []
        };
    });

    let count = 0;
    for (let key in masterDB.products) {
        if (masterDB.products[key].type === 'giftbox') {
            masterDB.products[key].contents = JSON.parse(JSON.stringify(standardContents));
            count++;
        }
    }

    saveMasterSystem();
    alert(`Success! Updated ${count} Gift Box recipes to the standard 8-flavor pack.`);
    switchSection('giftboxes');
}

// --- AUTO MIGRATE IMAGES (LOCAL FOLDER -> SUPABASE) ---
async function uploadAllLocalImagesToSupabase(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    if (typeof IMAGE_DB === 'undefined') return alert('No IMAGE_DB found in products.js');
    if (!confirm(`Found ${files.length} total files in that folder. The system will match them against your catalog and safely upload. Proceed?`)) return;

    // Create a fast lookup map for the files the user just selected based on filename
    const fileLookup = {};
    for (let i = 0; i < files.length; i++) {
        fileLookup[files[i].name.toLowerCase()] = files[i];
    }

    alert("Processing started! Please do not close the window. You will receive an alert when it is complete.");

    let count = 0;
    let matchCount = 0;
    let errorMsgs = [];
    
    try {
        for (const [name, idealPath] of Object.entries(IMAGE_DB)) {
            if (masterDB.products[name] && idealPath) {
                // If it's already a cloud link, skip
                if (idealPath.startsWith('http')) continue;
                
                // target filename from products.js (e.g. "images/65gProducts/PH65G.png" -> "ph65g.png")
                const idealFilename = idealPath.split('/').pop().toLowerCase();
                const matchedFile = fileLookup[idealFilename];
                
                if (matchedFile) {
                    matchCount++;
                    try {
                        // Upload directly to Supabase Storage
                        const cloudUrl = await window.AppDB.uploadProductImage(matchedFile, name);
                        
                        // Update Memory
                        masterDB.products[name].image = cloudUrl;
                        
                        // Update Database 
                        await window.AppDB.saveProduct(masterDB.products[name]);
                        count++;
                    } catch(err) {
                        console.error(`Failed to upload ${matchedFile.name}`, err);
                        if(errorMsgs.length < 3) errorMsgs.push(err.message);
                    }
                }
            }
        }
        
        if (matchCount === 0) {
            alert(`Zero matches! Ensure your selected folder actually contains the exact image files like 'PH65G.png' or 'chickfloss.webp'. We checked ${files.length} files but none matched your Catalog.`);
        } else if (errorMsgs.length > 0) {
            alert(`Found ${matchCount} matching images locally, but Supabase Cloud rejected the upload!\n\nReason: ${errorMsgs[0]}\n\n(This means you need to enable 'INSERT' Storage Policies on your bucket).`);
        } else {
            alert(`Success! Verified, securely uploaded, and natively linked ${count} images to Supabase Storage!`);
        }
        renderInventory();
    } catch (e) {
        alert("Failed to upload sequence: " + e.message);
        console.error(e);
    }
}

// --- REPLICATION FROM THECODE.PHP ---
function replicateFromTheCode() {
    if (!confirm("This will import specific bundles from thecode.php and apply the FHC->Cheese replacement rules. Proceed?")) return;

    const shortcodes = {
        'CF30G': 'chicken floss 30g',
        'CC30G': 'chilli crab 30g',
        'CH30G': 'chocolate 30g',
        'FHC30G': 'holy cheese 30g', // User Rule: Replace with Cheese
        'KBT30G': 'kaya butter toast 30g',
        'NL30G': 'nasi lemak 30g',
        'PH30G': 'pulut hitam 30g',
        'SC30G': 'salted caramel 30g',
        'CS30G': 'holy cheese 30g',
        'CF65G': 'chicken floss 65g',
        'CC65G': 'chilli crab 65g',
        'CH65G': 'chocolate 65g',
        'FHC65G': null, // User Rule: Remove if 65g
        'KBT65G': 'kaya butter toast 65g',
        'NL65G': 'nasi lemak 65g',
        'PH65G': 'pulut hitam 65g',
        'SC65G': 'salted caramel 65g',
        'CaramelPP': 'poppa salted caramel',
        'ChocolatePP': 'poppa chocolate popcorn',
        'SquidYCC': 'yumi squid corn curls',
        'CheeseYCC': 'yumi cheese corn curls',
        'BarbequeYCC': 'yumi bbq corn curls',
        'OriginalYumi': 'yumi original corn stick',
        'BBQYumi': 'yumi bbq chicken corn stick',
        'CheeseYumi': 'yumi cheese corn stick',
        'ChocolateBrony35G': 'chocolate brony 35g',
        'MatchaB35G': 'matcha brony 35g',
        'MachaBrony35G': 'matcha brony 35g',
        'BananaB': 'brony banana fritter',
        'PeanutB': 'brony peanut pancake',
        'ChocolateB': 'brony chocolate chip',
        'WheatCCones': 'yumi original corn stick',
        'ChickenCCones': 'yumi bbq chicken corn stick',
        'MayoCCones': 'yumi cheese corn stick',
        'birthday': 'birthday sleeve',
        'newyear': 'new year sleeve',
        'valentines': 'valentines sleeve',
        'nationalday': 'national day sleeve',
        'childrensday': 'children day sleeve',
        'minions': 'minions sleeve',
        'teachers': 'teacher sleeve',
        'huat': 'huat sleeve',
        'zhong': 'zhong sleeve',
        'kou': 'kou sleeve',
        'giftbox': 'gift box'
    };

    const legacyBundles = {
        "The Kettle Gourmet Birthday Gift Set (8 x 30g)": {
            shopeeKey: "thekettlegourmetpopcornbirthdaygiftset(assortmentof8packsx30g)",
            items: ['CF30G', 'CC30G', 'CH30G', 'FHC30G', 'KBT30G', 'NL30G', 'PH30G', 'SC30G', 'birthday', 'giftbox']
        },
        "Assorted Mini Pack Popcorn Bundle Box (8 x 30g)": {
            shopeeKey: "thekettlegourmetoriginalminipackpopcornbundlebox(assortmentof8x30g)",
            items: ['CF30G', 'CC30G', 'CH30G', 'FHC30G', 'KBT30G', 'NL30G', 'PH30G', 'SC30G', 'giftbox']
        },
        "Assorted Singles Popcorn Gift Box (8 x 65g)": {
            shopeeKey: "The Kettle Gourmet Assorted Singles Popcorn Gift Box (8 x 65g)",
            items: ['CF65G', 'CC65G', 'CH65G', 'FHC65G', 'KBT65G', 'NL65G', 'PH65G', 'SC65G', 'giftbox']
        },
        "CNY HUAT Gift Set (Assorted)": {
            shopeeKey: "The Kettle Gourmet CNY HUAT Gift Set (Assortment of Snacks)",
            items: ['KBT30G', 'FHC30G', 'CH30G', 'WheatCCones', 'CheeseYumi', 'ChocolateBrony35G', 'ChocolateBrony35G', 'MachaBrony35G', 'MachaBrony35G', 'NL30G', 'CF30G', 'SC30G', 'ChickenCCones', 'OriginalYumi', 'PH30G', 'CC30G', 'CS30G', 'MayoCCones', 'zhong', 'huat', 'kou', 'giftbox']
        },
        "Valentine's Day Forever Love Gift Box": {
            shopeeKey: "The Kettle Gourmet Valentine's Day Forever Love Gift Box",
            items: ['CF30G', 'CH30G', 'NL65G', 'SC65G', 'valentines', 'giftbox']
        },
        "National Day Bundle (8 x 30g)": {
            shopeeKey: "The Kettle Gourmet National Day Bundle (Assortment of 8 x 30g)",
            items: ['CF30G', 'CC30G', 'CH30G', 'FHC30G', 'KBT30G', 'NL30G', 'PH30G', 'SC30G', 'nationalday', 'giftbox']
        }
    };

    const snackMonsters = [
        ["Nasi Lemak Snack Monsters (8 x 65g)", "NL65G"],
        ["Chocolate Snack Monsters (8 x 65g)", "CH65G"],
        ["Kaya Butter Toast Snack Monsters (8 x 65g)", "KBT65G"],
        ["Chilli Crab Snack Monsters (8 x 65g)", "CC65G"],
        ["Chicken Floss Snack Monsters (8 x 65g)", "CF65G"],
        ["Salted Caramel Snack Monsters (8 x 65g)", "SC65G"],
        ["Pulut Hitam Snack Monsters (8 x 65g)", "PH65G"],
        ["Fish Head Curry Snack Monsters (8 x 65g)", "FHC65G"] // Will be skipped in loop
    ];

    let count = 0;

    // Process Main Bundles
    for (const [name, config] of Object.entries(legacyBundles)) {
        const itemNames = config.items.map(code => shortcodes[code]).filter(n => !!n);
        if (itemNames.length === 0) continue;

        const tally = {};
        itemNames.forEach(n => tally[n] = (tally[n] || 0) + 1);

        const contents = Object.entries(tally).map(([itemName, qty]) => {
            const p = masterDB.products[itemName];
            return { name: itemName, count: qty, barcodes: p ? p.barcodes : [] };
        });

        masterDB.products[name] = {
            name: name,
            type: name.toLowerCase().includes('box') || name.toLowerCase().includes('set') ? 'giftbox' : 'bundle',
            barcodes: [],
            contents: contents,
            requireInnerScan: name.toLowerCase().includes('gift')
        };
        masterDB.mapping[config.shopeeKey] = name;
        count++;
    }

    // Process Snack Monsters
    snackMonsters.forEach(([name, code]) => {
        const masterName = shortcodes[code];
        if (!masterName) return; // Skip FHC

        const p = masterDB.products[masterName];
        masterDB.products[name] = {
            name: name,
            type: 'bundle',
            barcodes: [],
            contents: [{ name: masterName, count: 8, barcodes: p ? p.barcodes : [] }],
            requireInnerScan: false
        };
        count++;
    });

    saveMasterSystem();
    alert(`Success! Replicated ${count} major bundles. FHC was replaced with Cheese (30g) or removed (65g) as requested.`);
    switchSection('inventory');
}

// --- APP INIT ---
document.addEventListener('DOMContentLoaded', loadMasterSystem);
