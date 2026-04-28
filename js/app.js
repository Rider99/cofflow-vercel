/**
 * COFFlow Web Application
 * Modern interface for Covalent Organic Framework generation
 * With Building Blocks Classification (Linkers & Nodes)
 */

// ============================================================
// Configuration
// ============================================================
const API_BASE = 'https://harlow-suboptic-serenely.ngrok-free.dev';
// In development, change to: 'http://localhost:5001'

// Intercept all fetch() calls to the backend and inject the ngrok bypass header.
// This prevents ngrok's browser warning page from blocking API responses.
(function () {
    const _nativeFetch = window.fetch.bind(window);
    window.fetch = function (url, options = {}) {
        if (typeof url === 'string' && url.startsWith(API_BASE)) {
            const headers = {
                'ngrok-skip-browser-warning': '1',
                ...(options.headers || {})
            };
            return _nativeFetch(url, { ...options, headers });
        }
        return _nativeFetch(url, options);
    };
})();
const ELEMENT_COLORS = {
    'H': '#FFFFFF', 'C': '#909090', 'N': '#3050F8', 'O': '#FF0D0D',
    'F': '#90E050', 'S': '#FFFF30', 'Cl': '#1FF01F', 'Br': '#A62929',
    'P': '#FF8000', 'B': '#FFB5B5', 'Si': '#F0C8A0', 'Fe': '#E06633',
    'Co': '#F090A0', 'Ni': '#50D050', 'Cu': '#C88033', 'Zn': '#7D80B0'
};

// ============================================================
// State Management
// ============================================================
const state = {
    // Classified building blocks
    linkers: [],
    nodes: [],
    currentCategory: 'linkers',  // 'linkers' or 'nodes'
    searchQuery: '',
    cpFilter: 'all',  // Connection points filter for nodes: 'all', '3', '4', '5', '6', etc.
    availableCPs: [],  // Available connection point values for nodes
    atomFilter: 'all',  // Atom count filter for linkers: 'all', '1-10', '11-20', etc.
    atomRanges: [],  // Available atom count ranges for linkers
    
    // Selected building blocks by type
    selectedLinkers: [],  // { path, name, count, atomCount, formula, type }
    selectedNodes: [],    // { path, name, count, atomCount, formula, type }
    
    // Currently viewing item
    currentViewing: null,  // { path, type, source } - source: 'list' or 'selected'
    
    // Legacy compatibility
    buildingBlocks: [],
    selectedBBs: [],
    
    // Viewers
    previewViewer: null,
    outputViewer: null,
    linkerPreviewViewer: null,
    nodePreviewViewer: null,
    generatedResult: null,
    currentOutputType: 'unitcell',

    // Examples
    examples: [],
    examplesLoaded: false,

    // User database system
    userEmail: localStorage.getItem('cofflow-user-email') || null,
    currentUserDB: localStorage.getItem('cofflow-user-db') || null,
    userDatabases: [],
    userLinkers: [],
    userNodes: [],
    userCurrentCategory: 'linkers',

    // Model selection
    availableModels: [],
    selectedModel: localStorage.getItem('cofflow-selected-model') || null,
    defaultModel: 'COFFlow-base'
};

// Get viewer background color based on current theme
function getViewerBackgroundColor() {
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    return theme === 'light' ? '#e2e8f0' : 'rgb(26, 34, 52)';
}

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

async function initializeApp() {
    // Check server health
    await checkServerHealth();

    // Load available models
    await loadAvailableModels();

    // Load classified building blocks (main database)
    await loadClassifiedBuildingBlocks();

    // Load user databases if email is set
    if (state.userEmail) {
        await loadUserDatabases();
        if (state.currentUserDB) {
            await loadUserBuildingBlocks();
        }
    }

    // Setup event listeners
    setupEventListeners();

    // Initialize 3D viewers
    initializeViewers();
}

// ============================================================
// Server Communication
// ============================================================
async function checkServerHealth() {
    const indicator = document.getElementById('status-indicator');
    const statusText = indicator.querySelector('.status-text');
    
    try {
        const response = await fetch(`${API_BASE}/api/health`);
        const data = await response.json();
        
        indicator.classList.remove('offline');
        indicator.classList.add('online');
        
        if (data.cuda_available) {
            indicator.classList.add('gpu');
            statusText.textContent = 'GPU Ready';
        } else {
            statusText.textContent = 'CPU Mode';
        }
    } catch (error) {
        indicator.classList.remove('online', 'gpu');
        indicator.classList.add('offline');
        statusText.textContent = 'Offline';
        showToast('error', 'Cannot connect to server');
    }
}

async function loadAvailableModels() {
    try {
        const response = await fetch(`${API_BASE}/api/models`);
        const data = await response.json();

        state.availableModels = data.models || [];
        state.defaultModel = data.default || 'COFFlow-base';

        // Use saved selection or default
        if (!state.selectedModel || !state.availableModels.find(m => m.name === state.selectedModel)) {
            state.selectedModel = state.defaultModel;
        }

        renderModelSelector();
    } catch (error) {
        console.error('Failed to load models:', error);
        state.availableModels = [];
    }
}

function renderModelSelector() {
    const container = document.getElementById('model-selector-container');
    if (!container) return;

    if (state.availableModels.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';

    const select = document.getElementById('model-select');
    if (!select) return;

    select.innerHTML = state.availableModels.map(model => {
        const selected = model.name === state.selectedModel ? 'selected' : '';
        const isDefault = model.name === state.defaultModel ? ' (Default)' : '';
        return `<option value="${model.name}" ${selected}>${model.name}${isDefault}</option>`;
    }).join('');
}

async function loadClassifiedBuildingBlocks() {
    const bbList = document.getElementById('bb-list');
    
    bbList.innerHTML = `
        <div class="loading-placeholder">
            <div class="spinner"></div>
            <span>Loading building blocks...</span>
        </div>
    `;
    
    try {
        const response = await fetch(`${API_BASE}/api/bb-classified`);
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        // Store classified building blocks
        state.linkers = data.linkers || [];
        state.nodes = data.nodes || [];
        
        // Update counts in tabs
        document.getElementById('linker-count').textContent = state.linkers.length;
        document.getElementById('node-count').textContent = state.nodes.length;
        
        // Extract available connection points for nodes
        const cpSet = new Set();
        state.nodes.forEach(node => {
            if (node.connection_points) {
                cpSet.add(node.connection_points);
            }
        });
        state.availableCPs = Array.from(cpSet).sort((a, b) => a - b);
        
        // Update CP filter buttons
        updateCPFilterButtons();
        
        // Calculate atom count ranges for linkers
        calculateAtomRanges();
        
        // Update atom filter buttons
        updateAtomFilterButtons();
        
        // Legacy compatibility
        state.buildingBlocks = [...state.linkers, ...state.nodes];

        // Render current category
        renderBuildingBlocks();

        showToast('success', `Loaded ${state.linkers.length} linkers and ${state.nodes.length} nodes`);
        
    } catch (error) {
        bbList.innerHTML = `
            <div class="loading-placeholder">
                <span style="color: var(--error);">Error: ${error.message}</span>
            </div>
        `;
        showToast('error', `Failed to load building blocks: ${error.message}`);
    }
}

function updateCPFilterButtons() {
    const container = document.getElementById('cp-filter-buttons');
    if (!container) return;
    
    // Create buttons: All + each available CP value
    let buttonsHTML = '<button class="cp-filter-btn active" data-cp="all">All</button>';
    
    state.availableCPs.forEach(cp => {
        buttonsHTML += `<button class="cp-filter-btn" data-cp="${cp}">${cp} CP</button>`;
    });
    
    container.innerHTML = buttonsHTML;
    
    // Add click handlers
    container.querySelectorAll('.cp-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active state
            container.querySelectorAll('.cp-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update filter
            state.cpFilter = btn.dataset.cp;
            renderBuildingBlocks();
        });
    });
}

function calculateAtomRanges() {
    // Get all atom counts from linkers
    const atomCounts = state.linkers
        .map(l => l.atom_count)
        .filter(a => a !== undefined && a !== null)
        .sort((a, b) => a - b);
    
    if (atomCounts.length === 0) {
        state.atomRanges = [];
        return;
    }
    
    const minAtoms = atomCounts[0];
    const maxAtoms = atomCounts[atomCounts.length - 1];
    
    // Create ranges based on actual data distribution
    // Use ranges of 10 atoms each
    const ranges = [];
    const rangeSize = 10;
    
    for (let start = Math.floor(minAtoms / rangeSize) * rangeSize; start <= maxAtoms; start += rangeSize) {
        const end = start + rangeSize - 1;
        const count = atomCounts.filter(a => a >= start && a <= end).length;
        if (count > 0) {
            ranges.push({
                min: start,
                max: end,
                label: `${start}-${end}`,
                count: count
            });
        }
    }
    
    state.atomRanges = ranges;
}

function updateAtomFilterButtons() {
    const container = document.getElementById('atom-filter-buttons');
    if (!container) return;
    
    // Create buttons: All + each atom range
    let buttonsHTML = `<button class="atom-filter-btn active" data-atoms="all">All (${state.linkers.length})</button>`;
    
    state.atomRanges.forEach(range => {
        buttonsHTML += `<button class="atom-filter-btn" data-atoms="${range.min}-${range.max}" title="${range.count} linkers">${range.label}</button>`;
    });
    
    container.innerHTML = buttonsHTML;
    
    // Add click handlers
    container.querySelectorAll('.atom-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update active state
            container.querySelectorAll('.atom-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update filter
            state.atomFilter = btn.dataset.atoms;
            renderBuildingBlocks();
        });
    });
}

// Legacy function for compatibility
async function loadBuildingBlocks() {
    await loadClassifiedBuildingBlocks();
}

async function loadBBContent(filename, filepath = null) {
    // Extract directory from filepath or use default
    let directory;
    if (filepath) {
        directory = filepath.substring(0, filepath.lastIndexOf('/'));
    } else {
        // Default to the building blocks database directory
        directory = '/blue/mingjieliu/yunrui.yan/Train/COFFlow_test/cofflow_web/uniq_frag_xyz_cleaned';
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/bb-content/${encodeURIComponent(filename)}?directory=${encodeURIComponent(directory)}`);
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        return data;
    } catch (error) {
        showToast('error', `Failed to load ${filename}: ${error.message}`);
        return null;
    }
}

async function generateCOF() {
    // Combine selected linkers and nodes
    const allSelectedBBs = [
        ...state.selectedLinkers,
        ...state.selectedNodes
    ];
    
    if (allSelectedBBs.length === 0) {
        showToast('error', 'Please add at least one building block (linker or node)');
        return;
    }
    
    const progressOverlay = document.getElementById('progress-overlay');
    const progressMessage = document.getElementById('progress-message');
    const progressFill = document.getElementById('progress-fill');
    let progressTimer = null;
    
    progressOverlay.classList.add('active');
    progressMessage.textContent = 'Preparing building blocks...';
    progressFill.style.width = '10%';
    
    try {
        const supercellX = parseInt(document.getElementById('supercell-x').value) || 2;
        const supercellY = parseInt(document.getElementById('supercell-y').value) || 2;
        const supercellZ = parseInt(document.getElementById('supercell-z').value) || 1;
        const outputName = document.getElementById('output-name').value || 'cof_generated';
        
        const buildingBlocks = allSelectedBBs.map(bb => ({
            path: bb.path,
            count: bb.count
        }));
        
        // Log selection summary
        const linkerCount = state.selectedLinkers.reduce((sum, bb) => sum + bb.count, 0);
        const nodeCount = state.selectedNodes.reduce((sum, bb) => sum + bb.count, 0);
        console.log(`Generating COF with ${linkerCount} linkers and ${nodeCount} nodes, supercell: ${supercellX}x${supercellY}x${supercellZ}`);
        
        progressMessage.textContent = `Loading model (${state.selectedModel || state.defaultModel})...`;
        progressFill.style.width = '20%';

        const startPct = 25;
        const endPct = 90;
        const estSeconds = 40;
        let elapsed = 0;
        progressTimer = setInterval(() => {
            elapsed += 0.5;
            const pct = Math.min(startPct + (endPct - startPct) * (elapsed / estSeconds), endPct);
            progressFill.style.width = pct + '%';
        }, 500);

        progressMessage.textContent = 'Generating candidates with Best-of-30; stopping early if a perfect score is found.';
        progressFill.style.width = startPct + '%';

        const response = await fetch(`${API_BASE}/api/generate-cof`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                building_blocks: buildingBlocks,
                supercell_size: [supercellX, supercellY, supercellZ],
                output_name: outputName,
                model: state.selectedModel || state.defaultModel
            })
        });

        clearInterval(progressTimer);
        progressTimer = null;

        progressMessage.textContent = 'Processing results...';
        progressFill.style.width = '95%';

        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }

        state.generatedResult = data;
        displayResults(data);
        
        progressFill.style.width = '100%';
        
        setTimeout(() => {
            progressOverlay.classList.remove('active');
            progressFill.style.width = '0%';
        }, 500);
        
        // Show appropriate toast based on validation status
        const validation = data.validation || {};
        if (validation.is_valid) {
            showToast('success', 'COF structure generated and validated successfully!');
        } else if (validation.status === 'invalid') {
            showToast('error', 'COF generated but validation failed. Please check the results.');
        } else {
            showToast('info', 'COF structure generated. Please review the validation results.');
        }
        
        // Switch to results tab
        switchTab('results');

        // Show recipe form if user uploaded fragments were used
        if (validation.is_valid) {
            const allSelected = [...state.selectedLinkers, ...state.selectedNodes];
            const hasCustom = allSelected.some(bb => bb.isUserUploaded);
            if (hasCustom && state.userEmail) {
                showRecipeModal();
            }
        }
        
    } catch (error) {
        if (progressTimer) clearInterval(progressTimer);
        progressOverlay.classList.remove('active');
        progressFill.style.width = '0%';
        showToast('error', `Generation failed: ${error.message}`);
        console.error('Generation error:', error);
    }
}

// ============================================================
// UI Rendering
// ============================================================
function renderBuildingBlocks() {
    const bbList = document.getElementById('bb-list');
    const cpFilterContainer = document.getElementById('cp-filter-container');
    const atomFilterContainer = document.getElementById('atom-filter-container');
    
    // Show/hide filters based on category
    if (cpFilterContainer) {
        cpFilterContainer.style.display = state.currentCategory === 'nodes' ? 'block' : 'none';
    }
    if (atomFilterContainer) {
        atomFilterContainer.style.display = state.currentCategory === 'linkers' ? 'block' : 'none';
    }
    
    // Get building blocks for current category
    const currentBBs = state.currentCategory === 'linkers' ? state.linkers : state.nodes;
    const selectedList = state.currentCategory === 'linkers' ? state.selectedLinkers : state.selectedNodes;
    
    // Filter by search query
    let filteredBBs = currentBBs;
    if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase();
        filteredBBs = filteredBBs.filter(bb => 
            bb.name.toLowerCase().includes(query) || 
            (bb.formula && bb.formula.toLowerCase().includes(query))
        );
    }
    
    // Apply CP filter for nodes
    if (state.currentCategory === 'nodes' && state.cpFilter !== 'all') {
        const cpValue = parseInt(state.cpFilter);
        filteredBBs = filteredBBs.filter(bb => bb.connection_points === cpValue);
    }
    
    // Apply atom count filter for linkers
    if (state.currentCategory === 'linkers' && state.atomFilter !== 'all') {
        const [minAtoms, maxAtoms] = state.atomFilter.split('-').map(Number);
        filteredBBs = filteredBBs.filter(bb => bb.atom_count >= minAtoms && bb.atom_count <= maxAtoms);
    }
    
    if (filteredBBs.length === 0) {
        const categoryName = state.currentCategory === 'linkers' ? 'linkers' : 'nodes';
        let emptyMessage = 'No ' + categoryName + ' found in database';
        if (state.searchQuery) {
            emptyMessage = 'No matching ' + categoryName + ' found';
        } else if (state.currentCategory === 'nodes' && state.cpFilter !== 'all') {
            emptyMessage = `No nodes with ${state.cpFilter} connection points found`;
        } else if (state.currentCategory === 'linkers' && state.atomFilter !== 'all') {
            emptyMessage = `No linkers with ${state.atomFilter} atoms found`;
        }
        bbList.innerHTML = `
            <div class="loading-placeholder">
                <span>${emptyMessage}</span>
            </div>
        `;
        return;
    }
    
    const bbType = state.currentCategory === 'linkers' ? 'linker' : 'node';
    
    bbList.innerHTML = filteredBBs.map((bb, index) => {
        const isAdded = selectedList.some(s => s.path === bb.path);
        const isViewing = state.currentViewing && state.currentViewing.path === bb.path && state.currentViewing.source === 'list';
        const connectionPoints = bb.connection_points || (bbType === 'linker' ? 2 : 3);

        return `
            <div class="bb-item ${bbType}-type ${isAdded ? 'added' : ''} ${isViewing ? 'viewing' : ''}" data-index="${index}" data-path="${bb.path}" data-type="${bbType}" data-name="${bb.name}">
                <div class="bb-icon ${bbType}">${connectionPoints}</div>
                <div class="bb-info">
                    <div class="bb-name" title="${bb.name}">${bb.name.replace('.xyz', '')}</div>
                    <div class="bb-meta">${bb.atom_count} atoms · ${bb.formula || ''} · <span class="cp-highlight ${bbType}">${connectionPoints} CP</span></div>
                </div>
                <div class="bb-actions">
                    <button class="btn btn-icon btn-small preview-btn" title="Preview">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                    <button class="btn btn-icon btn-small add-btn" title="${isAdded ? 'Added' : 'Add'}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            ${isAdded ? '<polyline points="20 6 9 17 4 12"/>' : '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'}
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // Add click handlers
    bbList.querySelectorAll('.bb-item').forEach(item => {
        const previewBtn = item.querySelector('.preview-btn');
        const addBtn = item.querySelector('.add-btn');
        const index = parseInt(item.dataset.index);
        const type = item.dataset.type;

        previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            previewBuildingBlockByType(index, type);
        });

        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleBuildingBlockByType(index, type);
        });

        item.addEventListener('click', () => {
            previewBuildingBlockByType(index, type);
        });
    });
}

function renderSelectedBBs() {
    renderSelectedLinkers();
    renderSelectedNodes();
    updateGenerationSummary();
}

function renderSelectedLinkers() {
    const container = document.getElementById('selected-linkers');
    const countBadge = document.getElementById('selected-linker-count');
    
    const totalCount = state.selectedLinkers.reduce((sum, bb) => sum + bb.count, 0);
    countBadge.textContent = totalCount;
    
    if (state.selectedLinkers.length === 0) {
        container.innerHTML = `
            <div class="empty-state small">
                <p>Click linkers from the left panel to add them</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = state.selectedLinkers.map((bb, index) => {
        const isViewing = state.currentViewing && state.currentViewing.path === bb.path && state.currentViewing.source === 'selected';
        return `
            <div class="selected-bb-item linker-type ${isViewing ? 'viewing' : ''}" data-index="${index}" data-type="linker" data-path="${bb.path}">
                <div class="bb-type-indicator linker"></div>
                <span class="selected-bb-name" title="${bb.name}">${bb.name.replace('.xyz', '')}</span>
                <span class="connection-points-badge linker" title="2 connection points">2 CP</span>
                <div class="selected-bb-count">
                    <button class="count-btn minus" data-index="${index}" data-type="linker" title="Decrease">−</button>
                    <span class="count-value" data-index="${index}">${bb.count}</span>
                    <button class="count-btn plus" data-index="${index}" data-type="linker" title="Increase">+</button>
                </div>
                <span class="remove-bb" data-index="${index}" data-type="linker">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </span>
            </div>
        `;
    }).join('');
    
    // Add click handler for preview
    container.querySelectorAll('.selected-bb-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.count-btn') || e.target.closest('.remove-bb')) return;
            const index = parseInt(item.dataset.index);
            previewSelectedBB(index, 'linker');
        });
    });
    
    // Add event handlers for count buttons
    container.querySelectorAll('.count-btn.minus').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = parseInt(btn.dataset.index);
            if (state.selectedLinkers[index].count > 1) {
                state.selectedLinkers[index].count--;
                renderSelectedBBs();
            }
        });
    });
    
    container.querySelectorAll('.count-btn.plus').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = parseInt(btn.dataset.index);
            if (state.selectedLinkers[index].count < 20) {
                state.selectedLinkers[index].count++;
                renderSelectedBBs();
            }
        });
    });
    
    container.querySelectorAll('.remove-bb').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = parseInt(btn.dataset.index);

            state.selectedLinkers.splice(index, 1);
            clearConfigPreview('linker');

            // Auto-preview first remaining linker if any
            if (state.selectedLinkers.length > 0) {
                previewSelectedBB(0, 'linker');
            }

            renderSelectedBBs();
            renderBuildingBlocks();
        });
    });
}

function renderSelectedNodes() {
    const container = document.getElementById('selected-nodes');
    const countBadge = document.getElementById('selected-node-count');
    
    const totalCount = state.selectedNodes.reduce((sum, bb) => sum + bb.count, 0);
    countBadge.textContent = totalCount;
    
    if (state.selectedNodes.length === 0) {
        container.innerHTML = `
            <div class="empty-state small">
                <p>Click nodes from the left panel to add them</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = state.selectedNodes.map((bb, index) => {
        const cp = bb.connectionPoints || bb.connection_points || '>2';
        const isViewing = state.currentViewing && state.currentViewing.path === bb.path && state.currentViewing.source === 'selected';
        return `
            <div class="selected-bb-item node-type ${isViewing ? 'viewing' : ''}" data-index="${index}" data-type="node" data-path="${bb.path}">
                <div class="bb-type-indicator node"></div>
                <span class="selected-bb-name" title="${bb.name}">${bb.name.replace('.xyz', '')}</span>
                <span class="connection-points-badge node" title="${cp} connection points">${cp} CP</span>
                <div class="selected-bb-count">
                    <button class="count-btn minus" data-index="${index}" data-type="node" title="Decrease">−</button>
                    <span class="count-value" data-index="${index}">${bb.count}</span>
                    <button class="count-btn plus" data-index="${index}" data-type="node" title="Increase">+</button>
                </div>
                <span class="remove-bb" data-index="${index}" data-type="node">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </span>
            </div>
        `;
    }).join('');
    
    // Add click handler for preview
    container.querySelectorAll('.selected-bb-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.count-btn') || e.target.closest('.remove-bb')) return;
            const index = parseInt(item.dataset.index);
            previewSelectedBB(index, 'node');
        });
    });
    
    // Add event handlers for count buttons
    container.querySelectorAll('.count-btn.minus').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = parseInt(btn.dataset.index);
            if (state.selectedNodes[index].count > 1) {
                state.selectedNodes[index].count--;
                renderSelectedBBs();
            }
        });
    });
    
    container.querySelectorAll('.count-btn.plus').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = parseInt(btn.dataset.index);
            if (state.selectedNodes[index].count < 20) {
                state.selectedNodes[index].count++;
                renderSelectedBBs();
            }
        });
    });
    
    container.querySelectorAll('.remove-bb').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = parseInt(btn.dataset.index);

            state.selectedNodes.splice(index, 1);
            clearConfigPreview('node');

            // Auto-preview first remaining node if any
            if (state.selectedNodes.length > 0) {
                previewSelectedBB(0, 'node');
            }

            renderSelectedBBs();
            renderBuildingBlocks();
        });
    });
}

function updateGenerationSummary() {
    const generateBtn = document.getElementById('generate-btn');
    const totalBBCount = document.getElementById('total-bb-count');
    
    const linkerTotal = state.selectedLinkers.reduce((sum, bb) => sum + bb.count, 0);
    const nodeTotal = state.selectedNodes.reduce((sum, bb) => sum + bb.count, 0);
    const total = linkerTotal + nodeTotal;
    
    totalBBCount.textContent = total;
    
    // Update legacy selectedBBs for compatibility
    state.selectedBBs = [
        ...state.selectedLinkers.map(bb => ({...bb, type: 'linker'})),
        ...state.selectedNodes.map(bb => ({...bb, type: 'node'}))
    ];
    
    // Enable generate button if we have at least one building block
    generateBtn.disabled = total === 0;
}

// Preview selected building block in config viewer
async function previewSelectedBB(index, type) {
    const selectedList = type === 'linker' ? state.selectedLinkers : state.selectedNodes;
    const bb = selectedList[index];
    if (!bb) return;
    
    // Update current viewing state
    state.currentViewing = { path: bb.path, type: type, source: 'selected' };
    
    // Re-render to update viewing indicator
    renderBuildingBlocks();
    renderSelectedBBs();
    
    // Update preview title based on type
    const titleId = type === 'linker' ? 'linker-preview-title' : 'node-preview-title';
    const previewTitle = document.getElementById(titleId);
    if (previewTitle) {
        previewTitle.textContent = bb.name.replace('.xyz', '');
    }
    
    // Load content and visualize in the appropriate viewer
    const content = await loadBBContent(bb.name, bb.path);
    if (!content) return;
    
    // Render in the correct preview viewer
    const viewerId = type === 'linker' ? 'linker-preview-viewer' : 'node-preview-viewer';
    renderMoleculeInConfigViewer(content.aligned_xyz, viewerId, type);
}

function renderMoleculeInConfigViewer(xyzContent, viewerId, type) {
    const container = document.getElementById(viewerId);
    if (!container) return;
    
    container.innerHTML = '';
    
    try {
        const viewer = $3Dmol.createViewer(container, {
            backgroundColor: getViewerBackgroundColor()
        });
        
        viewer.addModel(xyzContent, 'xyz');
        
        viewer.setStyle({}, {
            stick: { radius: 0.15, colorscheme: 'Jmol' },
            sphere: { scale: 0.25, colorscheme: 'Jmol' }
        });
        
        viewer.zoomTo();
        viewer.render();
        
        // Store viewer reference based on type
        if (type === 'linker') {
            state.linkerPreviewViewer = viewer;
        } else {
            state.nodePreviewViewer = viewer;
        }
        
    } catch (error) {
        console.error('3Dmol error:', error);
        container.innerHTML = `
            <div class="viewer-placeholder">
                <p style="color: var(--error);">Preview unavailable</p>
            </div>
        `;
    }
}

function clearConfigPreview(type) {
    if (type === 'linker') {
        const container = document.getElementById('linker-preview-viewer');
        if (container) {
            container.innerHTML = `
                <div class="viewer-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
                        <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1.5"/>
                        <path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/>
                    </svg>
                    <p>Click a linker to preview</p>
                </div>
            `;
        }
        const title = document.getElementById('linker-preview-title');
        if (title) title.textContent = 'Linker Preview';
        state.linkerPreviewViewer = null;
    } else if (type === 'node') {
        const container = document.getElementById('node-preview-viewer');
        if (container) {
            container.innerHTML = `
                <div class="viewer-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32">
                        <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1.5"/>
                        <path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/>
                    </svg>
                    <p>Click a node to preview</p>
                </div>
            `;
        }
        const title = document.getElementById('node-preview-title');
        if (title) title.textContent = 'Node Preview';
        state.nodePreviewViewer = null;
    }
    
    // Clear current viewing if it matches the type
    if (state.currentViewing && state.currentViewing.type === type) {
        state.currentViewing = null;
    }
}

function updateSupercellHint() {
    const x = document.getElementById('supercell-x')?.value || 2;
    const y = document.getElementById('supercell-y')?.value || 2;
    const z = document.getElementById('supercell-z')?.value || 1;
    const hint = document.getElementById('supercell-hint');
    if (hint) {
        hint.textContent = `Creates ${x}×${y}×${z} supercell`;
    }
}

function displayResults(data) {
    const container = document.getElementById('results-container');
    const validation = data.validation || {};
    const validationStatus = validation.status || 'pending';
    
    container.innerHTML = `
        <div class="result-card with-validation ${validationStatus}">
            <h4>Generation Complete</h4>
            <div class="result-stats">
                <div class="stat-item">
                    <div class="stat-value">${data.num_building_blocks}</div>
                    <div class="stat-label">Building Blocks</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${data.unitcell.atom_count}</div>
                    <div class="stat-label">Unit Cell Atoms</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${data.supercell.atom_count}</div>
                    <div class="stat-label">Supercell Atoms</div>
                </div>
            </div>
        </div>
        
        <!-- Validation Status Section -->
        <div class="validation-section">
            <div class="validation-header">
                <h4 style="margin: 0;">Structure Validation</h4>
                ${renderValidationBadge(validationStatus)}
            </div>
            
            <div class="validation-message ${validationStatus}">
                ${validation.message || 'Validation pending...'}
            </div>
            
            <div class="validation-toggle" id="validation-toggle">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
                <span>Show detailed checks</span>
            </div>
            
            <div class="validation-details" id="validation-details">
                <div class="validation-checks">
                    ${renderValidationChecks(validation.checks)}
                </div>
            </div>
        </div>

        ${renderScoreBreakdown(data.scoring)}
        
        <div class="result-card">
            <h4>Unit Cell</h4>
            <p style="color: var(--text-secondary); font-family: var(--font-mono); font-size: 0.85rem;">
                ${data.unitcell.formula}
            </p>
        </div>
        <div class="result-card">
            <h4>Supercell</h4>
            <p style="color: var(--text-secondary); font-family: var(--font-mono); font-size: 0.85rem;">
                ${data.supercell.formula}
            </p>
        </div>
    `;
    
    // Setup validation toggle
    const toggle = document.getElementById('validation-toggle');
    const details = document.getElementById('validation-details');
    toggle.addEventListener('click', () => {
        toggle.classList.toggle('expanded');
        details.classList.toggle('visible');
        toggle.querySelector('span').textContent = 
            details.classList.contains('visible') ? 'Hide detailed checks' : 'Show detailed checks';
    });

    // Setup score breakdown toggle
    const scoreToggle = document.getElementById('score-toggle');
    const scoreDetails = document.getElementById('score-details');
    if (scoreToggle && scoreDetails) {
        scoreToggle.addEventListener('click', () => {
            scoreToggle.classList.toggle('expanded');
            scoreDetails.classList.toggle('visible');
            scoreToggle.querySelector('span').textContent =
                scoreDetails.classList.contains('visible') ? 'Hide score breakdown' : 'Show score breakdown';
        });
    }
    
    // Update lattice parameters
    updateLatticeParams(data.lattice);
    
    // Enable download buttons
    document.getElementById('download-unitcell').disabled = false;
    document.getElementById('download-supercell').disabled = false;
    document.getElementById('download-all').disabled = false;
    
    // Display structure in output viewer
    displayOutputStructure('unitcell');
}

function renderValidationBadge(status) {
    const icons = {
        valid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        invalid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
    };
    
    const labels = {
        valid: 'Structure Validated',
        invalid: 'Structure Invalid',
        warning: 'Needs Review',
        pending: 'Pending'
    };
    
    return `
        <span class="validation-badge ${status}">
            ${icons[status] || icons.pending}
            ${labels[status] || 'Unknown'}
        </span>
    `;
}

function renderValidationChecks(checks) {
    if (!checks) return '<p style="color: var(--text-muted);">No validation data available</p>';
    
    const checkNames = {
        'ase_read': 'ASE Read',
        'pymatgen_read': 'Pymatgen Read',
        'bonds': 'Bond Analysis',
        'connectivity': 'Connectivity',
        'rdkit': 'RDKit Sanitization',
        'physical_validity': 'Physical Validity',
        'dimensionality': 'Dimensionality'
    };

    const checkOrder = ['ase_read', 'pymatgen_read', 'bonds', 'connectivity', 'rdkit', 'physical_validity', 'dimensionality'];

    const statusIcons = {
        ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>',
        fail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/></svg>'
    };

    const orderedKeys = [
        ...checkOrder.filter(k => k in checks),
        ...Object.keys(checks).filter(k => !checkOrder.includes(k))
    ];

    return orderedKeys.map(key => {
        const check = checks[key];
        const status = check.status || 'pending';
        return `
            <div class="validation-check">
                <div class="check-icon ${status}">
                    ${statusIcons[status] || statusIcons.pending}
                </div>
                <span class="check-name">${checkNames[key] || key}</span>
                <span class="check-message">${check.message || '—'}</span>
            </div>
        `;
    }).join('');
}

function renderScoreBreakdown(scoring) {
    if (!scoring) return '';

    const breakdown = scoring.breakdown || {};
    const checkNames = {
        'ase_read': 'ASE Read',
        'pymatgen_read': 'Pymatgen Read',
        'bonds': 'Bond Analysis',
        'connectivity': 'Connectivity',
        'rdkit': 'RDKit Sanitization',
        'physical_validity': 'Physical Validity',
        'dimensionality': 'Dimensionality'
    };
    const checkOrder = ['bonds', 'connectivity', 'physical_validity', 'rdkit', 'ase_read', 'pymatgen_read', 'dimensionality'];
    const orderedKeys = [
        ...checkOrder.filter(k => k in breakdown),
        ...Object.keys(breakdown).filter(k => !checkOrder.includes(k))
    ];
    const allScores = Array.isArray(scoring.all_scores) ? scoring.all_scores : [];
    const bestScore = Number(scoring.winner_score || 0);
    const maxScore = Number(scoring.max_score || 0);
    const nSamples = scoring.n_samples || allScores.length || 1;
    const maxSamples = scoring.max_samples || nSamples;
    const winnerIndex = scoring.winner_index;
    const scoreRange = allScores.length
        ? `${Math.min(...allScores).toFixed(1)}-${Math.max(...allScores).toFixed(1)}`
        : 'n/a';
    const showSelectionMessage = scoring.selected_valid_candidate === false && scoring.selection_message;

    return `
        <div class="validation-section score-section">
            <div class="validation-header">
                <h4 style="margin: 0;">Best-of-${nSamples} Selection</h4>
                <span class="score-pill" title="Score is additive, not normalized. Pass earns full check weight, warn earns half, fail earns 0. Connectivity gets partial credit as weight divided by component count, so 0.75 can display as 0.8.">${bestScore.toFixed(1)} / ${maxScore.toFixed(0)}</span>
            </div>

            <div class="score-summary">
                <span>Winner: candidate ${winnerIndex !== undefined ? winnerIndex + 1 : 'n/a'}</span>
                <span>${scoring.stopped_early ? `Stopped early before ${maxSamples}` : `Max ${maxSamples}`}</span>
                <span>Candidate scores: ${scoreRange}</span>
                ${scoring.total_time_s !== undefined ? `<span>Total: ${scoring.total_time_s}s</span>` : ''}
            </div>

            ${showSelectionMessage ? `<div class="score-note">${scoring.selection_message}</div>` : ''}

            <div class="validation-toggle" id="score-toggle">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
                <span>Show score breakdown</span>
            </div>

            <div class="validation-details" id="score-details">
                <div class="validation-checks">
                    ${orderedKeys.map(key => {
                        const item = breakdown[key] || {};
                        const status = item.status || 'pending';
                        const earned = Number(item.earned || 0);
                        const weight = Number(item.weight || 0);
                        return `
                            <div class="validation-check score-check">
                                <div class="check-icon ${status}">${status === 'ok' ? '✓' : status === 'warn' ? '!' : status === 'fail' ? '×' : '-'}</div>
                                <span class="check-name">${checkNames[key] || key}</span>
                                <span class="score-earned">${earned.toFixed(1)} / ${weight.toFixed(0)}</span>
                                <span class="check-message">${item.message || ''}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
}

function updateLatticeParams(lattice) {
    document.getElementById('lat-a').textContent = lattice.a.toFixed(2) + ' Å';
    document.getElementById('lat-b').textContent = lattice.b.toFixed(2) + ' Å';
    document.getElementById('lat-c').textContent = lattice.c.toFixed(2) + ' Å';
    document.getElementById('lat-alpha').textContent = lattice.alpha.toFixed(1) + '°';
    document.getElementById('lat-beta').textContent = lattice.beta.toFixed(1) + '°';
    document.getElementById('lat-gamma').textContent = lattice.gamma.toFixed(1) + '°';
}

// ============================================================
// 3D Visualization
// ============================================================
function initializeViewers() {
    // Viewers will be initialized on demand
}

async function previewBuildingBlockByType(index, type) {
    const currentBBs = type === 'linker' ? state.linkers : state.nodes;
    
    // Apply search filter to get actual BB
    let filteredBBs = currentBBs;
    if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase();
        filteredBBs = filteredBBs.filter(bb => 
            bb.name.toLowerCase().includes(query) || 
            (bb.formula && bb.formula.toLowerCase().includes(query))
        );
    }
    
    // Apply CP filter for nodes
    if (type === 'node' && state.cpFilter !== 'all') {
        const cpValue = parseInt(state.cpFilter);
        filteredBBs = filteredBBs.filter(bb => bb.connection_points === cpValue);
    }
    
    // Apply atom filter for linkers
    if (type === 'linker' && state.atomFilter !== 'all') {
        const [minAtoms, maxAtoms] = state.atomFilter.split('-').map(Number);
        filteredBBs = filteredBBs.filter(bb => bb.atom_count >= minAtoms && bb.atom_count <= maxAtoms);
    }
    
    const bb = filteredBBs[index];
    if (!bb) return;
    
    // Update current viewing state
    state.currentViewing = { path: bb.path, type: type, source: 'list' };
    
    // Re-render to update viewing indicator
    renderBuildingBlocks();
    renderSelectedBBs();
    
    // Switch to preview tab
    switchTab('preview');
    
    // Update preview title with connection points info
    const typeLabel = type === 'linker' ? `[Linker ${bb.atom_count} atoms]` : `[Node ${bb.connection_points || '>2'} CP]`;
    document.getElementById('preview-title').textContent = `${typeLabel} ${bb.name}`;
    
    // Load content and visualize
    const content = await loadBBContent(bb.name, bb.path);
    if (!content) return;
    
    // Update info
    document.getElementById('info-atoms').textContent = content.atom_count;
    document.getElementById('info-formula').textContent = content.formula;
    
    // Render 3D
    renderMolecule('preview-viewer', content.aligned_xyz);
}

// Legacy function for compatibility
async function previewBuildingBlock(index) {
    const bb = state.buildingBlocks[index];
    if (!bb) return;
    
    const type = bb.type || (state.linkers.some(l => l.path === bb.path) ? 'linker' : 'node');
    
    // Switch to preview tab
    switchTab('preview');
    
    // Update preview title
    const typeLabel = type === 'linker' ? '[Linker]' : '[Node]';
    document.getElementById('preview-title').textContent = `${typeLabel} ${bb.name}`;
    
    // Load content and visualize
    const content = await loadBBContent(bb.name, bb.path);
    if (!content) return;
    
    // Update info
    document.getElementById('info-atoms').textContent = content.atom_count;
    document.getElementById('info-formula').textContent = content.formula;
    
    // Render 3D
    renderMolecule('preview-viewer', content.aligned_xyz);
}

function renderMolecule(containerId, xyzContent) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    // Clear placeholder
    container.innerHTML = '';
    
    try {
        // Create viewer with theme-aware background
        const viewer = $3Dmol.createViewer(container, {
            backgroundColor: getViewerBackgroundColor()
        });
        
        // Add model
        viewer.addModel(xyzContent, 'xyz');
        
        // Style atoms
        viewer.setStyle({}, {
            stick: { radius: 0.15, colorscheme: 'Jmol' },
            sphere: { scale: 0.25, colorscheme: 'Jmol' }
        });
        
        // Zoom and render
        viewer.zoomTo();
        viewer.render();
        
        // Enable rotation
        viewer.setClickable({}, true);
        
        if (containerId === 'preview-viewer') {
            state.previewViewer = viewer;
        } else if (containerId === 'output-viewer') {
            state.outputViewer = viewer;
        }
        
    } catch (error) {
        console.error('3Dmol error:', error);
        container.innerHTML = `
            <div class="viewer-placeholder">
                <p style="color: var(--error);">3D visualization unavailable</p>
                <pre style="font-size: 0.7rem; max-height: 200px; overflow: auto; text-align: left; padding: 1rem;">${xyzContent.substring(0, 500)}...</pre>
            </div>
        `;
    }
}

function renderCIF(containerId, cifContent) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    
    try {
        // Create viewer with theme-aware background
        const viewer = $3Dmol.createViewer(container, {
            backgroundColor: getViewerBackgroundColor()
        });
        
        viewer.addModel(cifContent, 'cif');
        
        viewer.setStyle({}, {
            stick: { radius: 0.12, colorscheme: 'Jmol' },
            sphere: { scale: 0.2, colorscheme: 'Jmol' }
        });
        
        viewer.addUnitCell();
        viewer.zoomTo();
        viewer.render();
        
        state.outputViewer = viewer;
        
    } catch (error) {
        console.error('CIF render error:', error);
        container.innerHTML = `
            <div class="viewer-placeholder">
                <p>Structure loaded (3D preview unavailable)</p>
            </div>
        `;
    }
}

function displayOutputStructure(type) {
    if (!state.generatedResult) return;
    
    state.currentOutputType = type;
    
    const cifContent = type === 'unitcell' 
        ? state.generatedResult.unitcell.cif_content 
        : state.generatedResult.supercell.cif_content;
    
    renderCIF('output-viewer', cifContent);
    
    // Update active tab
    document.querySelectorAll('.output-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.output === type);
    });
}

// ============================================================
// Building Block Management
// ============================================================
function toggleBuildingBlockByType(index, type) {
    const currentBBs = type === 'linker' ? state.linkers : state.nodes;
    const selectedList = type === 'linker' ? state.selectedLinkers : state.selectedNodes;
    
    // Apply search filter to get actual BB
    let filteredBBs = currentBBs;
    if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase();
        filteredBBs = filteredBBs.filter(bb => 
            bb.name.toLowerCase().includes(query) || 
            (bb.formula && bb.formula.toLowerCase().includes(query))
        );
    }
    
    // Apply CP filter for nodes
    if (type === 'node' && state.cpFilter !== 'all') {
        const cpValue = parseInt(state.cpFilter);
        filteredBBs = filteredBBs.filter(bb => bb.connection_points === cpValue);
    }
    
    // Apply atom filter for linkers
    if (type === 'linker' && state.atomFilter !== 'all') {
        const [minAtoms, maxAtoms] = state.atomFilter.split('-').map(Number);
        filteredBBs = filteredBBs.filter(bb => bb.atom_count >= minAtoms && bb.atom_count <= maxAtoms);
    }
    
    const bb = filteredBBs[index];
    if (!bb) return;
    
    const existingIndex = selectedList.findIndex(s => s.path === bb.path);
    
    if (existingIndex >= 0) {
        selectedList.splice(existingIndex, 1);
        clearConfigPreview(type);
        // Auto-preview first remaining item if any
        if (selectedList.length > 0) {
            previewSelectedBB(0, type);
        }
    } else {
        const connectionPoints = bb.connection_points || (type === 'linker' ? 2 : 3);
        selectedList.push({
            path: bb.path,
            name: bb.name,
            count: 1,
            atomCount: bb.atom_count,
            formula: bb.formula,
            type: type,
            connectionPoints: connectionPoints,
            connection_points: connectionPoints  // For compatibility
        });

        // Auto-preview the newly added item
        const newIndex = selectedList.length - 1;
        previewSelectedBB(newIndex, type);

        // Notify if adding to an existing recipe
        const otherList = type === 'linker' ? state.selectedNodes : state.selectedLinkers;
        if (selectedList.length > 1 || otherList.length > 0) {
            showToast('info', `Added "${bb.name.replace('.xyz', '')}" to current recipe`);
        }
    }

    renderSelectedBBs();
    renderBuildingBlocks();
}

// Legacy function for compatibility
function toggleBuildingBlock(index) {
    const bb = state.buildingBlocks[index];
    if (!bb) return;
    
    const type = bb.type || (state.linkers.some(l => l.path === bb.path) ? 'linker' : 'node');
    const selectedList = type === 'linker' ? state.selectedLinkers : state.selectedNodes;
    
    const existingIndex = selectedList.findIndex(s => s.path === bb.path);
    
    if (existingIndex >= 0) {
        selectedList.splice(existingIndex, 1);
    } else {
        selectedList.push({
            path: bb.path,
            name: bb.name,
            count: 1,
            atomCount: bb.atom_count,
            formula: bb.formula,
            type: type
        });
    }
    
    renderSelectedBBs();
    renderBuildingBlocks();
}

// ============================================================
// Tab Navigation
// ============================================================
function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });
}

// ============================================================
// Examples Feature
// ============================================================
async function loadExamples() {
    const container = document.getElementById('examples-list');
    container.innerHTML = `
        <div class="empty-state">
            <div class="loading-spinner"></div>
            <p>Loading examples...</p>
        </div>
    `;

    try {
        const response = await fetch(`${API_BASE}/api/examples`);
        const data = await response.json();

        if (data.error) throw new Error(data.error);

        state.examples = data.examples || [];
        state.examplesLoaded = true;
        renderExamples();
    } catch (error) {
        container.innerHTML = `
            <div class="empty-state">
                <p style="color: var(--error);">Failed to load examples: ${error.message}</p>
            </div>
        `;
    }
}

function renderExamples() {
    const container = document.getElementById('examples-list');

    if (state.examples.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No examples available</p>
            </div>
        `;
        return;
    }

    container.innerHTML = state.examples.map(example => {
        const nodes = example.building_blocks.filter(bb => bb.type === 'node');
        const linkers = example.building_blocks.filter(bb => bb.type === 'linker');
        const unknowns = example.building_blocks.filter(bb => bb.type === 'unknown');

        const bbListHTML = [...nodes, ...linkers, ...unknowns].map(bb => {
            const typeClass = bb.type === 'node' ? 'node' : bb.type === 'linker' ? 'linker' : 'unknown';
            const typeLabel = bb.type === 'node' ? 'Node' : bb.type === 'linker' ? 'Linker' : '?';
            const displayName = bb.name.replace('.xyz', '');
            return `
                <div class="example-bb-item">
                    <span class="example-bb-type-badge ${typeClass}">${typeLabel}</span>
                    <span class="example-bb-name" title="${displayName}">${displayName}</span>
                    <span class="example-bb-meta">${bb.atom_count} atoms</span>
                    <span class="example-bb-count">&times;${bb.count}</span>
                </div>
            `;
        }).join('');

        const displayName = example.display_num ? `Example ${example.display_num}` : `COF #${example.cof_id}`;
        const topologyHTML = example.topology ? `<span class="example-topology-badge">${example.topology}</span>` : '';

        return `
            <div class="example-card">
                <div class="example-card-header">
                    <div class="example-cof-id">${displayName} ${topologyHTML}</div>
                    <div class="example-summary">
                        ${example.node_count > 0 ? `<span class="example-stat node">${example.node_count} node${example.node_count !== 1 ? 's' : ''}</span>` : ''}
                        ${example.linker_count > 0 ? `<span class="example-stat linker">${example.linker_count} linker${example.linker_count !== 1 ? 's' : ''}</span>` : ''}
                        <span class="example-stat total">${example.total_fragments} fragments</span>
                    </div>
                </div>
                <div class="example-bb-list">
                    ${bbListHTML}
                </div>
                <div class="example-card-actions">
                    <button class="btn btn-primary btn-sm example-load-btn" onclick="loadExampleRecipe(${example.cof_id})">
                        Load Recipe
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function loadExampleRecipe(cofId) {
    const example = state.examples.find(e => e.cof_id === cofId);
    if (!example) return;

    // Clear current selections and viewers
    state.selectedLinkers = [];
    state.selectedNodes = [];
    clearConfigPreview('linker');
    clearConfigPreview('node');

    // Populate from example building blocks
    example.building_blocks.forEach(bb => {
        const entry = {
            path: bb.path,
            name: bb.name,
            count: bb.count,
            atom_count: bb.atom_count,
            formula: bb.formula,
            type: bb.type,
            connection_points: bb.connection_points
        };

        if (bb.type === 'node') {
            state.selectedNodes.push(entry);
        } else {
            state.selectedLinkers.push(entry);
        }
    });

    // Update UI and switch to Configure tab
    renderSelectedBBs();
    renderBuildingBlocks();
    updateGenerationSummary();
    switchTab('configure');

    // Auto-preview first linker and node
    if (state.selectedLinkers.length > 0) {
        previewSelectedBB(0, 'linker');
    }
    if (state.selectedNodes.length > 0) {
        previewSelectedBB(0, 'node');
    }

    const displayName = example.display_num ? `Example ${example.display_num}` : `COF #${cofId}`;
    showToast('success', `Loaded recipe for ${displayName} with ${example.building_blocks.length} building block type${example.building_blocks.length !== 1 ? 's' : ''}`);
}

// ============================================================
// Download Functions
// ============================================================
async function downloadFile(path) {
    // Uses fetch (not anchor href) so the fetch interceptor can add the
    // ngrok-skip-browser-warning header; anchor clicks cannot carry headers.
    try {
        const response = await fetch(`${API_BASE}/api/download-cif?path=${encodeURIComponent(path)}`);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = path.split('/').pop();
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Download failed:', err);
        showToast('error', 'Download failed. Please try again.');
    }
}

async function downloadAll() {
    if (!state.generatedResult) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/download-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: [
                    state.generatedResult.unitcell.path,
                    state.generatedResult.supercell.path
                ]
            })
        });
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'cof_structures.zip';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        
    } catch (error) {
        showToast('error', `Download failed: ${error.message}`);
    }
}

// ============================================================
// Toast Notifications
// ============================================================
function showToast(type, message) {
    const container = document.getElementById('toast-container');
    
    const icons = {
        success: '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
        error: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
        info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
    };
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${icons[type] || icons.info}
        </svg>
        <span class="toast-message">${message}</span>
        <button class="toast-close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        </button>
    `;
    
    container.appendChild(toast);
    
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => toast.remove());
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// ============================================================
// Event Listeners
// ============================================================
// ============================================================
// Documentation
// ============================================================
let docsData = null;

function simpleMarkdown(md) {
    // Convert markdown to HTML (lightweight, no external deps)
    let html = md
        // Images: ![alt](src) - rewrite relative image paths to API
        .replace(/!\[([^\]]*)\]\(images\/([^)]+)\)/g, '<img src="/api/docs/images/$2" alt="$1" class="docs-image">')
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="docs-image">')
        // Code blocks
        .replace(/```([^`]*?)```/gs, '<pre><code>$1</code></pre>')
        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Bold
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        // Headings
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        // Horizontal rules
        .replace(/^---$/gm, '<hr>')
        // Tables
        .replace(/^\|(.+)\|$/gm, (match) => {
            const cells = match.split('|').filter(c => c.trim());
            if (cells.every(c => /^[\s-:]+$/.test(c))) return '<!--table-sep-->';
            const tag = 'td';
            const row = cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('');
            return `<tr>${row}</tr>`;
        });

    // Remove table separator lines before grouping rows
    html = html.replace(/<!--table-sep-->\n?/g, '');

    // Wrap consecutive table rows
    html = html.replace(/((<tr>.*<\/tr>\n?)+)/g, (match) => {
        if (!match.trim()) return '';
        // Make first row header
        const headerified = match.replace(/<tr>(.*?)<\/tr>/, (m, inner) => {
            return '<thead><tr>' + inner.replace(/<td>/g, '<th>').replace(/<\/td>/g, '</th>') + '</tr></thead><tbody>';
        }) + '</tbody>';
        return `<table>${headerified}</table>`;
    });

    // Unordered lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/gs, (match) => `<ul>${match}</ul>`);

    // Ordered lists
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Paragraphs - wrap remaining non-tag lines
    html = html.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('<')) return line;
        return `<p>${line}</p>`;
    }).join('\n');

    return html;
}

async function loadDocs() {
    if (docsData) {
        renderDocsNav();
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/docs`);
        const data = await response.json();
        docsData = data.sections || [];
        renderDocsNav();
        if (docsData.length > 0) {
            showDocSection(0);
        }
    } catch (error) {
        document.getElementById('docs-content').innerHTML = `
            <div class="empty-state">
                <p style="color: var(--error);">Failed to load documentation: ${error.message}</p>
            </div>
        `;
    }
}

function renderDocsNav() {
    const nav = document.getElementById('docs-nav');
    nav.innerHTML = docsData.map((section, i) => `
        <li class="docs-nav-item ${i === 0 ? 'active' : ''}" data-index="${i}">
            ${section.title}
        </li>
    `).join('');

    nav.querySelectorAll('.docs-nav-item').forEach(item => {
        item.addEventListener('click', () => {
            showDocSection(parseInt(item.dataset.index));
        });
    });
}

function showDocSection(index) {
    const section = docsData[index];
    if (!section) return;

    document.getElementById('docs-content').innerHTML = simpleMarkdown(section.content);

    document.querySelectorAll('.docs-nav-item').forEach(item => {
        item.classList.toggle('active', parseInt(item.dataset.index) === index);
    });
}

function switchView(view) {
    const mainContent = document.querySelector('.main-content');
    const docsView = document.getElementById('docs-view');

    if (view === 'docs') {
        mainContent.style.display = 'none';
        docsView.style.display = 'flex';
        loadDocs();
    } else {
        mainContent.style.display = '';
        docsView.style.display = 'none';
    }

    // Update nav link active state
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    const activeId = view === 'docs' ? 'nav-docs' : 'nav-generator';
    const activeLink = document.getElementById(activeId);
    if (activeLink) activeLink.classList.add('active');
}

function setupEventListeners() {
    // Navigation links
    document.getElementById('nav-generator').addEventListener('click', (e) => {
        e.preventDefault();
        switchView('generator');
    });
    document.getElementById('nav-docs').addEventListener('click', (e) => {
        e.preventDefault();
        switchView('docs');
    });

    // Refresh building blocks
    document.getElementById('refresh-bb-btn').addEventListener('click', loadClassifiedBuildingBlocks);

    // Collapsible sections
    setupCollapsibleSection('main-db-header', 'main-db-content');
    setupCollapsibleSection('custom-db-header', 'custom-db-content');

    // Category tabs (Linkers / Nodes)
    document.querySelectorAll('.bb-category-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const category = tab.dataset.category;
            state.currentCategory = category;
            
            // Update active state
            document.querySelectorAll('.bb-category-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.category === category);
            });
            
            // Re-render building blocks list
            renderBuildingBlocks();
        });
    });
    
    // Search input
    const searchInput = document.getElementById('bb-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.searchQuery = e.target.value;
            renderBuildingBlocks();
        });
        
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                state.searchQuery = '';
                searchInput.value = '';
                renderBuildingBlocks();
            }
        });
    }
    
    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            switchTab(tab.dataset.tab);
            if (tab.dataset.tab === 'examples' && !state.examplesLoaded) {
                loadExamples();
            }
        });
    });
    
    // Output tabs
    document.querySelectorAll('.output-tab').forEach(tab => {
        tab.addEventListener('click', () => displayOutputStructure(tab.dataset.output));
    });
    
    // Stepper buttons
    document.querySelectorAll('.stepper-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.target);
            const current = parseInt(input.value);
            const min = parseInt(input.min);
            const max = parseInt(input.max);
            
            if (btn.dataset.action === 'increment' && current < max) {
                input.value = current + 1;
            } else if (btn.dataset.action === 'decrement' && current > min) {
                input.value = current - 1;
            }
            
            // Update supercell hint if it's a supercell control
            if (btn.dataset.target && btn.dataset.target.startsWith('supercell-')) {
                updateSupercellHint();
            }
        });
    });
    
    // Supercell input change listeners
    ['supercell-x', 'supercell-y', 'supercell-z'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('change', updateSupercellHint);
        }
    });
    
    // Model selector
    const modelSelect = document.getElementById('model-select');
    if (modelSelect) {
        modelSelect.addEventListener('change', (e) => {
            state.selectedModel = e.target.value;
            localStorage.setItem('cofflow-selected-model', state.selectedModel);
        });
    }

    // Generate button
    document.getElementById('generate-btn').addEventListener('click', generateCOF);

    // Download buttons
    document.getElementById('download-unitcell').addEventListener('click', () => {
        if (state.generatedResult) {
            downloadFile(state.generatedResult.unitcell.path);
        }
    });
    
    document.getElementById('download-supercell').addEventListener('click', () => {
        if (state.generatedResult) {
            downloadFile(state.generatedResult.supercell.path);
        }
    });
    
    document.getElementById('download-all').addEventListener('click', downloadAll);
    
    // Reset view button
    document.getElementById('reset-view').addEventListener('click', () => {
        if (state.previewViewer) {
            state.previewViewer.zoomTo();
            state.previewViewer.render();
        }
    });
    
    // Theme toggle button
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
    
    // Initialize theme from localStorage
    initializeTheme();

    // Custom fragment upload
    setupUploadHandlers();
}

// ============================================================
// Theme Management (Dark/Light Mode)
// ============================================================
function initializeTheme() {
    const savedTheme = localStorage.getItem('cofflow-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('cofflow-theme', newTheme);
    updateThemeIcon(newTheme);
    
    // Update 3D viewer backgrounds
    refreshViewerBackgrounds();
    
    showToast('info', `Switched to ${newTheme} mode`);
}

function refreshViewerBackgrounds() {
    const bgColor = getViewerBackgroundColor();
    
    // Update preview viewer
    if (state.previewViewer) {
        state.previewViewer.setBackgroundColor(bgColor);
        state.previewViewer.render();
    }
    
    // Update output viewer
    if (state.outputViewer) {
        state.outputViewer.setBackgroundColor(bgColor);
        state.outputViewer.render();
    }
    
    // Update linker preview viewer
    if (state.linkerPreviewViewer) {
        state.linkerPreviewViewer.setBackgroundColor(bgColor);
        state.linkerPreviewViewer.render();
    }
    
    // Update node preview viewer
    if (state.nodePreviewViewer) {
        state.nodePreviewViewer.setBackgroundColor(bgColor);
        state.nodePreviewViewer.render();
    }
}

function updateThemeIcon(theme) {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;
    
    if (theme === 'dark') {
        themeToggle.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/>
                <line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/>
                <line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
        `;
        themeToggle.title = 'Switch to light mode';
    } else {
        themeToggle.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
        `;
        themeToggle.title = 'Switch to dark mode';
    }
}

// ============================================================
// Collapsible Sections
// ============================================================
function setupCollapsibleSection(headerId, contentId) {
    const header = document.getElementById(headerId);
    const content = document.getElementById(contentId);
    if (!header || !content) return;

    header.addEventListener('click', (e) => {
        // Don't toggle if clicking a button inside the header
        if (e.target.closest('button:not(.collapse-toggle)') || e.target.closest('#refresh-bb-btn')) return;
        const collapsed = content.classList.toggle('collapsed');
        header.classList.toggle('collapsed', collapsed);
    });
}

// ============================================================
// User Database System
// ============================================================

async function loadUserDatabases() {
    if (!state.userEmail) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/user-db/list?email=${encodeURIComponent(state.userEmail)}`);
        const data = await response.json();
        state.userDatabases = data.databases || [];
        updateUserDBDropdown();
    } catch (err) {
        console.error('Failed to load user databases:', err);
        state.userDatabases = [];
    }
}

function updateUserDBDropdown() {
    const select = document.getElementById('user-db-select');
    if (!select) return;
    
    let options = '<option value="">-- Select or Create Database --</option>';
    state.userDatabases.forEach(db => {
        const selected = db.db_name === state.currentUserDB ? 'selected' : '';
        options += `<option value="${db.db_name}" ${selected}>${db.db_name}</option>`;
    });
    select.innerHTML = options;
}

async function loadUserBuildingBlocks() {
    if (!state.currentUserDB) {
        state.userLinkers = [];
        state.userNodes = [];
        updateUserBBSection();
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/user-db/building-blocks?db_name=${encodeURIComponent(state.currentUserDB)}`);
        const data = await response.json();
        
        if (data.error) {
            console.error('Error loading user BBs:', data.error);
            state.userLinkers = [];
            state.userNodes = [];
        } else {
            state.userLinkers = data.linkers || [];
            state.userNodes = data.nodes || [];
        }
        
        updateUserBBSection();
    } catch (err) {
        console.error('Failed to load user building blocks:', err);
        state.userLinkers = [];
        state.userNodes = [];
        updateUserBBSection();
    }
}

function updateUserBBSection() {
    const section = document.getElementById('user-bb-section');
    const dbNameEl = document.getElementById('user-bb-db-name');
    const linkerCount = document.getElementById('user-linker-count');
    const nodeCount = document.getElementById('user-node-count');
    
    if (!state.currentUserDB) {
        section.style.display = 'none';
        return;
    }
    
    section.style.display = 'block';
    dbNameEl.textContent = `(${state.currentUserDB})`;
    linkerCount.textContent = state.userLinkers.length;
    nodeCount.textContent = state.userNodes.length;
    
    renderUserBuildingBlocks();
}

function renderUserBuildingBlocks() {
    const list = document.getElementById('user-bb-list');
    const currentBBs = state.userCurrentCategory === 'linkers' ? state.userLinkers : state.userNodes;
    const selectedList = state.userCurrentCategory === 'linkers' ? state.selectedLinkers : state.selectedNodes;
    const bbType = state.userCurrentCategory === 'linkers' ? 'linker' : 'node';
    
    if (currentBBs.length === 0) {
        list.innerHTML = `
            <div class="loading-placeholder">
                <span>No ${state.userCurrentCategory} uploaded yet</span>
            </div>
        `;
        return;
    }
    
    list.innerHTML = currentBBs.map((bb, index) => {
        const isAdded = selectedList.some(s => s.path === bb.path);
        const connectionPoints = bb.connection_points || (bbType === 'linker' ? 2 : 3);
        
        return `
            <div class="user-bb-item ${isAdded ? 'added' : ''}" data-index="${index}" data-path="${bb.path}" data-type="${bbType}" data-name="${bb.name}">
                <div class="user-bb-icon ${bbType}">${connectionPoints}</div>
                <div class="user-bb-info">
                    <div class="user-bb-name" title="${bb.name}">${bb.name.replace('.xyz', '')}</div>
                    <div class="user-bb-meta">${bb.atom_count} atoms · ${bb.formula || ''}</div>
                </div>
                <div class="user-bb-actions">
                    <button class="btn btn-icon btn-small preview-btn" title="Preview">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                    <button class="btn btn-icon btn-small add-btn" title="${isAdded ? 'Remove' : 'Add'}">
                        ${isAdded ? '−' : '+'}
                    </button>
                    <button class="btn btn-icon btn-small delete-btn" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    // Add click handlers
    list.querySelectorAll('.user-bb-item').forEach(item => {
        const previewBtn = item.querySelector('.preview-btn');
        const addBtn = item.querySelector('.add-btn');
        const deleteBtn = item.querySelector('.delete-btn');
        const index = parseInt(item.dataset.index);
        const type = item.dataset.type;
        const name = item.dataset.name;
        const path = item.dataset.path;

        previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const bbs = type === 'linker' ? state.userLinkers : state.userNodes;
            const bb = bbs[index];
            if (bb) previewBuildingBlockByPath(bb.path, type);
        });

        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleUserBuildingBlock(index, type);
        });

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showDeleteConfirmation(name, state.currentUserDB);
        });

        item.addEventListener('click', () => {
            // Preview the building block
            const bbs = type === 'linker' ? state.userLinkers : state.userNodes;
            const bb = bbs[index];
            if (bb) {
                previewBuildingBlockByPath(bb.path, type);
            }
        });
    });
}

function toggleUserBuildingBlock(index, type) {
    const bbs = type === 'linker' ? state.userLinkers : state.userNodes;
    const selectedList = type === 'linker' ? state.selectedLinkers : state.selectedNodes;
    const bb = bbs[index];
    
    if (!bb) return;
    
    const existingIndex = selectedList.findIndex(s => s.path === bb.path);
    
    if (existingIndex >= 0) {
        selectedList.splice(existingIndex, 1);
    } else {
        selectedList.push({
            path: bb.path,
            name: bb.name,
            count: 1,
            atomCount: bb.atom_count,
            formula: bb.formula,
            type: type,
            connectionPoints: bb.connection_points,
            isUserUploaded: true,
            dbName: state.currentUserDB
        });
    }
    
    renderUserBuildingBlocks();
    renderSelectedBBs();
    validateRecipe();
}

async function previewBuildingBlockByPath(path, type) {
    // Switch to preview tab
    switchTab('preview');

    const filename = path.split('/').pop();

    // Load content via the same helper used by the main database
    const content = await loadBBContent(filename, path);
    if (!content) return;

    // Update preview title
    const typeLabel = type === 'linker'
        ? `[Linker ${content.atom_count} atoms]`
        : `[Node ${content.connection_points || '>2'} CP]`;
    document.getElementById('preview-title').textContent = `${typeLabel} ${filename}`;

    // Update info panel
    document.getElementById('info-atoms').textContent = content.atom_count;
    document.getElementById('info-formula').textContent = content.formula;

    // Render 3D preview
    renderMolecule('preview-viewer', content.aligned_xyz);
}

// ============================================================
// Custom Fragment Upload
// ============================================================
function setupUploadHandlers() {
    const dropZone = document.getElementById('upload-drop-zone');
    const fileInput = document.getElementById('upload-file-input');
    const fileInfo = document.getElementById('upload-file-info');
    const filenameSpan = document.getElementById('upload-filename');
    const clearBtn = document.getElementById('upload-clear-btn');
    const controls = document.getElementById('upload-controls');
    const submitBtn = document.getElementById('upload-submit-btn');
    const statusDiv = document.getElementById('upload-status');
    const cpSelector = document.getElementById('upload-cp-selector');
    const dbSelect = document.getElementById('user-db-select');
    const createDbBtn = document.getElementById('create-db-btn');
    const deleteDbBtn = document.getElementById('delete-db-btn');

    let selectedFile = null;
    let selectedType = null;
    let selectedCP = null;

    // Gate: require email before uploading
    function requireEmail(callback) {
        if (state.userEmail) {
            callback();
            return;
        }
        showEmailModal(async () => {
            await loadUserDatabases();
            callback();
        });
    }
    
    // Gate: require database selection
    function requireDatabase(callback) {
        if (!state.currentUserDB) {
            showToast('warning', 'Please select or create a database first');
            return;
        }
        callback();
    }

    // Database selection change
    dbSelect.addEventListener('change', async () => {
        const dbName = dbSelect.value;
        state.currentUserDB = dbName;
        if (dbName) {
            localStorage.setItem('cofflow-user-db', dbName);
            await loadUserBuildingBlocks();
        } else {
            localStorage.removeItem('cofflow-user-db');
            state.userLinkers = [];
            state.userNodes = [];
            updateUserBBSection();
        }
    });
    
    // Create database button
    createDbBtn.addEventListener('click', () => {
        requireEmail(() => showCreateDBModal());
    });
    
    // Delete database button
    deleteDbBtn.addEventListener('click', () => {
        if (!state.currentUserDB) return;
        showDeleteDBConfirmation(state.currentUserDB);
    });
    
    // User BB tabs
    document.querySelectorAll('.user-bb-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.user-bb-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            state.userCurrentCategory = tab.dataset.type;
            renderUserBuildingBlocks();
        });
    });

    // Click drop zone or browse button to trigger file input (with email gate)
    const browseBtn = document.getElementById('upload-browse-btn');
    dropZone.addEventListener('click', (e) => {
        if (e.target === browseBtn || e.target.closest('#upload-browse-btn')) return;
        requireEmail(() => requireDatabase(() => fileInput.click()));
    });
    browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        requireEmail(() => requireDatabase(() => fileInput.click()));
    });

    // File input change
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            requireEmail(() => requireDatabase(() => showFileSelected(e.target.files[0])));
        }
    });

    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            if (!file.name.endsWith('.xyz')) {
                showUploadStatus('Only .xyz files are accepted', 'error');
                return;
            }
            requireEmail(() => requireDatabase(() => showFileSelected(file)));
        }
    });

    // Clear button
    clearBtn.addEventListener('click', resetUploadUI);

    // Type selector buttons (Linker / Node)
    document.querySelectorAll('.upload-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.upload-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedType = btn.dataset.type;
            selectedCP = null;

            // Show/hide CP selector
            if (selectedType === 'node') {
                cpSelector.style.display = 'block';
                document.querySelectorAll('.upload-cp-btn').forEach(b => b.classList.remove('active'));
                submitBtn.disabled = true; // Require CP selection
            } else {
                cpSelector.style.display = 'none';
                submitBtn.disabled = false;
            }
        });
    });

    // CP selector buttons (for nodes)
    document.querySelectorAll('.upload-cp-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.upload-cp-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedCP = btn.dataset.cp;
            submitBtn.disabled = false;
        });
    });

    // Submit button
    submitBtn.addEventListener('click', () => uploadFragment());

    function showFileSelected(file) {
        selectedFile = file;
        dropZone.style.display = 'none';
        fileInfo.style.display = 'flex';
        filenameSpan.textContent = file.name;
        controls.style.display = 'flex';
        statusDiv.style.display = 'none';
        // Reset type/CP selection
        selectedType = null;
        selectedCP = null;
        document.querySelectorAll('.upload-type-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.upload-cp-btn').forEach(b => b.classList.remove('active'));
        cpSelector.style.display = 'none';
        submitBtn.disabled = true;
    }

    function resetUploadUI() {
        selectedFile = null;
        selectedType = null;
        selectedCP = null;
        fileInput.value = '';
        dropZone.style.display = 'flex';
        fileInfo.style.display = 'none';
        controls.style.display = 'none';
        statusDiv.style.display = 'none';
        cpSelector.style.display = 'none';
        document.querySelectorAll('.upload-type-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.upload-cp-btn').forEach(b => b.classList.remove('active'));
        submitBtn.disabled = true;
    }

    function showUploadStatus(message, type) {
        statusDiv.textContent = message;
        statusDiv.className = 'upload-status ' + type;
        statusDiv.style.display = 'block';
    }

    async function uploadFragment() {
        if (!selectedFile || !selectedType) return;
        if (selectedType === 'node' && !selectedCP) return;
        if (!state.currentUserDB) {
            showUploadStatus('Please select a database first', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Uploading...';

        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('type', selectedType);
        formData.append('email', state.userEmail || '');
        formData.append('db_name', state.currentUserDB);
        if (selectedType === 'node') {
            formData.append('cp', selectedCP);
        }

        try {
            const response = await fetch(`${API_BASE}/api/upload-bb`, {
                method: 'POST',
                body: formData
            });
            const result = await response.json();

            if (!response.ok || result.error) {
                showUploadStatus(result.error || 'Upload failed', 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Add to Database';
                return;
            }

            showUploadStatus(
                `Added "${result.name}" as ${result.type} (${result.connection_points} CP)`,
                'success'
            );
            showToast('success', `Added "${result.name.replace('.xyz', '')}" to your database`);

            // Refresh user building block list
            await loadUserBuildingBlocks();
            
            // Switch to correct tab in user BB section
            state.userCurrentCategory = result.type === 'linker' ? 'linkers' : 'nodes';
            document.querySelectorAll('.user-bb-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.type === state.userCurrentCategory);
            });
            renderUserBuildingBlocks();

            // Reset UI after a short delay
            setTimeout(() => {
                resetUploadUI();
                submitBtn.disabled = true;
                submitBtn.textContent = 'Add to Database';
            }, 2000);

        } catch (err) {
            showUploadStatus('Upload failed: ' + err.message, 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Add to Database';
        }
    }
}

// ============================================================
// Email Registration
// ============================================================
function showEmailModal(onSuccess) {
    const modal = document.getElementById('email-modal');
    const input = document.getElementById('email-input');
    const submitBtn = document.getElementById('email-submit-btn');
    const cancelBtn = document.getElementById('email-cancel-btn');

    modal.style.display = 'flex';
    input.value = '';
    input.focus();

    function cleanup() {
        modal.style.display = 'none';
        submitBtn.removeEventListener('click', handleSubmit);
        cancelBtn.removeEventListener('click', handleCancel);
        input.removeEventListener('keydown', handleKeydown);
    }

    function handleSubmit() {
        const email = input.value.trim();
        if (!email || !email.includes('@')) {
            input.style.borderColor = 'var(--danger)';
            return;
        }
        state.userEmail = email;
        localStorage.setItem('cofflow-user-email', email);
        cleanup();
        if (onSuccess) onSuccess();
    }

    function handleCancel() {
        cleanup();
    }

    function handleKeydown(e) {
        if (e.key === 'Enter') handleSubmit();
        else if (e.key === 'Escape') handleCancel();
        else input.style.borderColor = '';
    }

    submitBtn.addEventListener('click', handleSubmit);
    cancelBtn.addEventListener('click', handleCancel);
    input.addEventListener('keydown', handleKeydown);
}

// ============================================================
// Create Database Modal
// ============================================================
function showCreateDBModal() {
    const modal = document.getElementById('create-db-modal');
    const input = document.getElementById('db-name-input');
    const submitBtn = document.getElementById('create-db-submit-btn');
    const cancelBtn = document.getElementById('create-db-cancel-btn');

    modal.style.display = 'flex';
    input.value = '';
    input.focus();

    function cleanup() {
        modal.style.display = 'none';
        submitBtn.removeEventListener('click', handleSubmit);
        cancelBtn.removeEventListener('click', handleCancel);
        input.removeEventListener('keydown', handleKeydown);
    }

    async function handleSubmit() {
        const dbName = input.value.trim();
        if (!dbName || dbName.length < 2) {
            input.style.borderColor = 'var(--danger)';
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/api/user-db/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    db_name: dbName,
                    email: state.userEmail
                })
            });
            const result = await response.json();

            if (!response.ok || result.error) {
                showToast('error', result.error || 'Failed to create database');
                return;
            }

            showToast('success', `Created database "${dbName}"`);
            
            // Reload databases and select the new one
            await loadUserDatabases();
            state.currentUserDB = dbName;
            localStorage.setItem('cofflow-user-db', dbName);
            updateUserDBDropdown();
            await loadUserBuildingBlocks();
            
            cleanup();
        } catch (err) {
            showToast('error', 'Failed to create database: ' + err.message);
        }
    }

    function handleCancel() {
        cleanup();
    }

    function handleKeydown(e) {
        if (e.key === 'Enter') handleSubmit();
        else if (e.key === 'Escape') handleCancel();
        else input.style.borderColor = '';
    }

    submitBtn.addEventListener('click', handleSubmit);
    cancelBtn.addEventListener('click', handleCancel);
    input.addEventListener('keydown', handleKeydown);
}

// ============================================================
// Delete Confirmation
// ============================================================
function showDeleteConfirmation(filename, dbName) {
    const modal = document.getElementById('delete-modal');
    const msgEl = document.getElementById('delete-modal-message');
    const confirmBtn = document.getElementById('delete-confirm-btn');
    const cancelBtn = document.getElementById('delete-cancel-btn');

    msgEl.textContent = `Delete "${filename.replace('.xyz', '')}" from your database?`;
    modal.style.display = 'flex';

    function cleanup() {
        modal.style.display = 'none';
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
    }

    async function handleConfirm() {
        cleanup();
        try {
            const response = await fetch(`${API_BASE}/api/delete-bb`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    filename, 
                    email: state.userEmail,
                    db_name: dbName || state.currentUserDB
                })
            });
            const result = await response.json();

            if (!response.ok || result.error) {
                showToast('error', result.error || 'Delete failed');
                return;
            }

            // Remove from selected lists if present
            state.selectedLinkers = state.selectedLinkers.filter(s => s.name !== filename);
            state.selectedNodes = state.selectedNodes.filter(s => s.name !== filename);
            renderSelectedBBs();

            showToast('success', `Removed "${filename.replace('.xyz', '')}"`);
            await loadUserBuildingBlocks();
        } catch (err) {
            showToast('error', 'Delete failed: ' + err.message);
        }
    }

    function handleCancel() {
        cleanup();
    }

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
}

function showDeleteDBConfirmation(dbName) {
    const modal = document.getElementById('delete-modal');
    const msgEl = document.getElementById('delete-modal-message');
    const confirmBtn = document.getElementById('delete-confirm-btn');
    const cancelBtn = document.getElementById('delete-cancel-btn');

    msgEl.textContent = `Delete entire database "${dbName}" and all its contents? This cannot be undone.`;
    modal.style.display = 'flex';

    function cleanup() {
        modal.style.display = 'none';
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
    }

    async function handleConfirm() {
        cleanup();
        try {
            const response = await fetch(`${API_BASE}/api/user-db/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    db_name: dbName,
                    email: state.userEmail
                })
            });
            const result = await response.json();

            if (!response.ok || result.error) {
                showToast('error', result.error || 'Delete failed');
                return;
            }

            showToast('success', `Deleted database "${dbName}"`);
            
            // Clear current selection
            state.currentUserDB = null;
            localStorage.removeItem('cofflow-user-db');
            state.userLinkers = [];
            state.userNodes = [];
            
            // Reload databases
            await loadUserDatabases();
            updateUserBBSection();
        } catch (err) {
            showToast('error', 'Delete failed: ' + err.message);
        }
    }

    function handleCancel() {
        cleanup();
    }

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
}

// ============================================================
// Recipe Submission
// ============================================================
function showRecipeModal() {
    const modal = document.getElementById('recipe-modal');
    const nameInput = document.getElementById('recipe-name');
    const topoInput = document.getElementById('recipe-topology');
    const descInput = document.getElementById('recipe-description');
    const bbSummary = document.getElementById('recipe-bb-summary');
    const submitBtn = document.getElementById('recipe-submit-btn');
    const skipBtn = document.getElementById('recipe-skip-btn');

    // Pre-fill fields
    nameInput.value = '';
    descInput.value = '';

    // Detect topology from fragment counts
    const totalLinkers = state.selectedLinkers.reduce((s, l) => s + l.count, 0);
    const totalNodes = state.selectedNodes.reduce((s, n) => s + n.count, 0);
    let topology = '';
    if (totalNodes === 2 && totalLinkers === 3) topology = 'hcb';
    else if (totalNodes === 2 && totalLinkers === 4) topology = 'sql / sql-2';
    topoInput.value = topology;

    // Build BB summary
    let summaryHTML = '';
    state.selectedNodes.forEach(n => {
        summaryHTML += `Node: ${n.name.replace('.xyz', '')} x${n.count} (${n.connectionPoints || n.connection_points} CP)<br>`;
    });
    state.selectedLinkers.forEach(l => {
        summaryHTML += `Linker: ${l.name.replace('.xyz', '')} x${l.count}<br>`;
    });
    bbSummary.innerHTML = summaryHTML;

    modal.style.display = 'flex';

    function cleanup() {
        modal.style.display = 'none';
        submitBtn.removeEventListener('click', handleSubmit);
        skipBtn.removeEventListener('click', handleSkip);
    }

    async function handleSubmit() {
        const recipeName = nameInput.value.trim();
        if (!recipeName) {
            nameInput.style.borderColor = 'var(--danger)';
            return;
        }

        const bbs = [];
        state.selectedNodes.forEach(n => bbs.push({ name: n.name, type: 'node', count: n.count }));
        state.selectedLinkers.forEach(l => bbs.push({ name: l.name, type: 'linker', count: l.count }));

        try {
            const response = await fetch(`${API_BASE}/api/submit-recipe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: recipeName,
                    topology: topoInput.value,
                    description: descInput.value.trim(),
                    email: state.userEmail,
                    building_blocks: bbs
                })
            });
            const result = await response.json();
            if (result.success) {
                showToast('success', 'Recipe submitted successfully!');
            }
        } catch (err) {
            showToast('error', 'Failed to submit recipe');
        }
        cleanup();
    }

    function handleSkip() {
        cleanup();
    }

    submitBtn.addEventListener('click', handleSubmit);
    skipBtn.addEventListener('click', handleSkip);
}
