/* ==========================================================================
   STATE MANAGEMENT & DATABASE SIMULATOR (NOW PERSISTED IN localStorage)
   ========================================================================== */

const STORAGE_KEY = 'Trackfound_state_v1';

let state = {
    currentUser: null,
    users: [],
    lostReports: [],
    foundReports: [],
    claims: [],
    messages: [],
    notifications: [],
    abuseReports: [],
    categories: [
        "Mobile Phones", "Wallets and Purses", "Bags and Backpacks", "Keys",
        "Identity Documents", "Books and Notebooks", "Electronics", "Jewellery",
        "Watches", "Clothes", "Vehicles and Accessories", "Pets", "Other"
    ]
};

// Current temporary preview image base64
let currentImagePreviewBase64 = null;
let activeChatThreadKey = null;
let editingReportId = null;
let imageRemovedForEdit = false;
let myReportsFilter = 'all';
let discoveryFilters = {
    keyword: '',
    category: 'all',
    location: '',
    mode: 'selected',
    radius: 'exact',
    type: 'all',
    status: 'Active',
    dateFrom: '',
    dateTo: '',
    sort: 'newest',
    origin: null,
    originSource: '',
    originLabel: ''
};

/* ==========================================================================
   LOCAL STORAGE (SAVE / LOAD)
   ========================================================================== */

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
        console.error('localStorage save failed:', err);
        // Usually happens when big photos exceed the ~5MB browser quota
        if (typeof showToast === 'function') {
            showToast("Storage full! Try smaller photos or delete old reports.", "error");
        }
    }
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
            throw new Error('Saved TrackFound data has an invalid structure.');
        }
        const arrayKeys = ['users', 'lostReports', 'foundReports', 'claims', 'messages', 'notifications', 'abuseReports'];
        arrayKeys.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(saved, key) && !Array.isArray(saved[key])) {
                console.warn(`Ignoring invalid local data for "${key}".`);
                saved[key] = [];
            }
        });
        state = Object.assign({}, state, saved);
        arrayKeys.forEach(key => {
            if (!Array.isArray(state[key])) state[key] = [];
        });
        // Keep currentUser pointing to the same object as in users[] (so role changes stay in sync)
        if (state.currentUser) {
            const match = state.users.find(u => u.id === state.currentUser.id);
            if (match) state.currentUser = match;
        }
    } catch (err) {
        console.error('localStorage load failed:', err);
        showToast("Saved local data couldn't be loaded. Existing data was left untouched.", "error");
    }
}

function resetAllData() {
    if (confirm("Delete ALL saved Trackfound data from this browser?")) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
    }
}

/* ==========================================================================
   PRIVACY GUARDRAIL (SENSITIVE DATA MASKING)
   ========================================================================== */

function redactSensitiveInput(text) {
    if (!text) return text;
    // Regex patterns for Aadhaar (12 digits), PAN (5 alpha 4 num 1 alpha), Credit Card (16 digits)
    const aadhaarPattern = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g;
    const panPattern = /\b[A-Z]{5}\d{4}[A-Z]{1}\b/gi;
    const ccPattern = /\b(?:\d[ -]*?){13,16}\b/g;

    let clean = text.replace(aadhaarPattern, "[Sensitive Aadhaar Redacted]");
    clean = clean.replace(panPattern, "[Sensitive PAN Redacted]");
    clean = clean.replace(ccPattern, "[Sensitive Card Number Redacted]");
    return clean;
}

/* ==========================================================================
   SMART MATCHING ALGORITHM ENGINE (Client-Side implementation of spec)
   ========================================================================== */

function calculateMatchScore(lostItem, foundItem) {
    let score = 0;
    const details = {};

    // 1. Category Match (25 Points)
    if (lostItem.category.toLowerCase() === foundItem.category.toLowerCase()) {
        score += 25;
        details.categoryMatch = true;
    }

    // 2. Title Similarity (20 Points)
    const lTitle = lostItem.title.toLowerCase();
    const fTitle = foundItem.title.toLowerCase();
    if (lTitle === fTitle) {
        score += 20;
        details.titleScore = 20;
    } else if (lTitle.includes(fTitle) || fTitle.includes(lTitle)) {
        score += 12;
        details.titleScore = 12;
    } else {
        // Word overlap
        const lWords = lTitle.split(/\s+/);
        const fWords = fTitle.split(/\s+/);
        const overlap = lWords.filter(w => w.length > 2 && fWords.includes(w));
        if (overlap.length > 0) {
            score += 8;
            details.titleScore = 8;
        }
    }

    // 3. Location Match (20 Points)
    const lLoc = `${lostItem.city} ${lostItem.area}`.toLowerCase();
    const fLoc = `${foundItem.city} ${foundItem.area}`.toLowerCase();
    if (lostItem.city.toLowerCase() === foundItem.city.toLowerCase()) {
        if (lostItem.area.toLowerCase() === foundItem.area.toLowerCase()) {
            score += 20;
            details.locationScore = 20;
        } else {
            score += 12;
            details.locationScore = 12;
        }
    }

    // 4. Color Match (15 Points)
    if (lostItem.color && foundItem.color) {
        if (lostItem.color.toLowerCase() === foundItem.color.toLowerCase()) {
            score += 15;
            details.colorMatch = true;
        } else if (lostItem.color.toLowerCase().includes(foundItem.color.toLowerCase()) || 
                   foundItem.color.toLowerCase().includes(lostItem.color.toLowerCase())) {
            score += 8;
            details.colorMatch = true;
        }
    }

    // 5. Date Proximity (10 Points)
    const d1 = new Date(lostItem.date);
    const d2 = new Date(foundItem.date);
    const diffDays = Math.abs((d1 - d2) / (1000 * 60 * 60 * 24));
    if (diffDays <= 2) {
        score += 10;
        details.dateScore = 10;
    } else if (diffDays <= 7) {
        score += 5;
        details.dateScore = 5;
    }

    // 6. Keywords Match (10 Points)
    const lDesc = lostItem.description.toLowerCase();
    const fDesc = foundItem.description.toLowerCase();
    const commonKeywords = ["wallet", "bag", "phone", "iphone", "samsung", "black", "leather", "watch", "key"];
    let kwScore = 0;
    commonKeywords.forEach(kw => {
        if (lDesc.includes(kw) && fDesc.includes(kw)) kwScore += 2;
    });
    score += Math.min(10, kwScore);
    details.keywordScore = Math.min(10, kwScore);

    return { score: Math.min(100, score), details };
}

function getMatchesForUser() {
    const matches = [];
    
    state.lostReports.forEach(lost => {
        state.foundReports.forEach(found => {
            if (lost.status === 'Active' && found.status === 'Active') {
                const result = calculateMatchScore(lost, found);
                if (result.score >= 40) {
                    matches.push({
                        lost,
                        found,
                        score: result.score,
                        details: result.details
                    });
                }
            }
        });
    });

    return matches.sort((a, b) => b.score - a.score);
}

/* ==========================================================================
   UI NAVIGATION & INITIALIZATION
   ========================================================================== */

window.onload = function() {
    loadState();          // restore saved data from localStorage first
    syncDiscoveryControls();
    renderAllViews();
};

function navTo(pageId) {
    closeMobileNav();
    if (pageId === 'dashboard' && !state.currentUser) {
        showToast("Log in to open your local dashboard.", "info");
        openAuthModal('login');
        return;
    }
    if (pageId === 'admin' && (!state.currentUser || state.currentUser.role !== 'admin')) {
        showToast("Admin access is required.", "error");
        return;
    }
    const destination = pageId === 'how-it-works' ? 'home' : pageId;
    document.querySelectorAll('.view-page').forEach(page => page.classList.add('hidden'));
    const target = document.getElementById(`page-${destination}`);
    if (target) target.classList.remove('hidden');

    // Reset navigation active state
    document.querySelectorAll('header nav button').forEach(btn => {
        btn.classList.remove('text-brand-700', 'bg-brand-50', 'font-semibold');
        btn.classList.add('text-gray-600');
    });
    const activeNavBtn = document.getElementById(`nav-${pageId}`);
    if (activeNavBtn) {
        activeNavBtn.classList.add('text-brand-700', 'bg-brand-50', 'font-semibold');
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderAllViews();
    if (pageId === 'how-it-works') {
        requestAnimationFrame(() => document.getElementById('how-it-works').scrollIntoView({ behavior: 'smooth' }));
    }
}

function toggleMobileNav() {
    const menu = document.getElementById('mobile-nav');
    const toggle = document.getElementById('mobile-nav-toggle');
    if (!menu || !toggle) return;
    const isOpening = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !isOpening);
    toggle.setAttribute('aria-expanded', String(isOpening));
    toggle.setAttribute('aria-label', isOpening ? 'Close navigation menu' : 'Open navigation menu');
    toggle.innerHTML = `<i class="fa-solid ${isOpening ? 'fa-xmark' : 'fa-bars'}"></i>`;
}

function closeMobileNav() {
    const menu = document.getElementById('mobile-nav');
    const toggle = document.getElementById('mobile-nav-toggle');
    if (!menu || !toggle) return;
    menu.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation menu');
    toggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
}

document.addEventListener('click', event => {
    const menu = document.getElementById('mobile-nav');
    const toggle = document.getElementById('mobile-nav-toggle');
    if (!menu || !toggle || menu.classList.contains('hidden')) return;
    const eventPath = event.composedPath();
    if (!menu.contains(event.target) && !toggle.contains(event.target) &&
        !eventPath.includes(menu) && !eventPath.includes(toggle)) {
        closeMobileNav();
    }
});

document.addEventListener('keydown', event => {
    const menu = document.getElementById('mobile-nav');
    const toggle = document.getElementById('mobile-nav-toggle');
    if (event.key === 'Escape' && menu && toggle && !menu.classList.contains('hidden')) {
        closeMobileNav();
        toggle.focus();
    }
});

window.addEventListener('resize', () => {
    if (window.matchMedia('(min-width: 1200px)').matches) closeMobileNav();
});

function renderAllViews() {
    syncDiscoveryControls();
    updateStatsCounters();
    renderRecentItemsHome();
    renderBrowseItems();
    renderAdvancedSearchResults();
    renderSmartMatches();
    renderDashboard();
    renderAdminPortal();
    updateAuthUI();
    saveState();          // persist after every UI refresh / data change
}

/* ==========================================================================
   NOTIFICATIONS (dropdown helpers)
   ========================================================================== */

function toggleNotifications() {
    document.getElementById('notif-dropdown').classList.toggle('hidden');
}

function clearNotifications() {
    state.notifications = [];
    document.getElementById('notif-list').innerHTML = '<div class="p-4 text-center text-gray-400">No new notifications</div>';
    document.getElementById('notif-badge').classList.add('hidden');
    saveState();
}

/* ==========================================================================
   STATS & EMPTY STATES RENDERERS
   ========================================================================== */

function updateStatsCounters() {
    const activeLost = state.lostReports.filter(r => r.status === 'Active').length;
    const activeFound = state.foundReports.filter(r => r.status === 'Active').length;
    const matches = getMatchesForUser().length;
    const returned = state.lostReports.filter(r => r.status === 'Returned').length + 
                     state.foundReports.filter(r => r.status === 'Returned').length;

    document.getElementById('stat-lost-count').innerText = activeLost;
    document.getElementById('stat-found-count').innerText = activeFound;
    document.getElementById('stat-matches-count').innerText = matches;
    document.getElementById('stat-returned-count').innerText = returned;

    // Matches badge in header
    const mBadge = document.getElementById('matches-badge');
    if (matches > 0) {
        mBadge.innerText = matches;
        mBadge.classList.remove('hidden');
    } else {
        mBadge.classList.add('hidden');
    }
}

function renderRecentItemsHome() {
    const grid = document.getElementById('recent-items-grid');
    const allItems = [...state.lostReports, ...state.foundReports]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 4);

    if (allItems.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full py-12 text-center bg-white rounded-2xl border border-gray-200">
                <i class="fa-solid fa-box-open text-4xl text-gray-300 mb-3"></i>
                <h4 class="font-bold text-gray-700">No active reports found in database</h4>
                <p class="text-xs text-gray-400 mt-1">Be the first community member to publish a Lost or Found item.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = allItems.map(item => createItemCardHTML(item)).join('');
}

function normalizeLocationText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getLocationFields(item, mode) {
    const values = {
        country: item.country,
        state: item.state,
        district: item.district,
        city: item.city,
        area: item.area,
        locality: item.locality,
        placeName: item.placeName
    };

    if (mode === 'city') return [values.city, values.district, values.state, values.country];
    if (mode === 'area') return [values.area, values.locality, values.district, values.city, values.state, values.country];
    if (['railway', 'bus', 'airport', 'college', 'market', 'place'].includes(mode)) {
        return [values.placeName, values.area, values.locality, values.city, values.district, values.state, values.country];
    }
    return Object.keys(values).map(key => values[key]);
}

function locationTextMatches(item, query, mode) {
    const normalizedQuery = normalizeLocationText(query);
    if (!normalizedQuery) return false;
    const haystack = normalizeLocationText(getLocationFields(item, mode).filter(Boolean).join(' '));
    if (haystack.includes(normalizedQuery)) return true;
    return normalizedQuery.split(' ').every(token => haystack.includes(token));
}

function getApproximateLocation(item) {
    const locality = item.placeName || item.locality || '';
    return [...new Set([locality, item.city, item.state].filter(Boolean).map(value => String(value).trim()))]
        .join(', ') || 'Location not specified';
}

function getReportCoordinates(item) {
    if (item.latitude == null || item.longitude == null ||
        item.latitude === '' || item.longitude === '') return null;
    const latitude = Number(item.latitude);
    const longitude = Number(item.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return null;
    }
    return { latitude, longitude };
}

function haversineDistanceKm(first, second) {
    const toRadians = degrees => degrees * Math.PI / 180;
    const latitudeDelta = toRadians(second.latitude - first.latitude);
    const longitudeDelta = toRadians(second.longitude - first.longitude);
    const firstLatitude = toRadians(first.latitude);
    const secondLatitude = toRadians(second.latitude);
    const haversine = Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    const boundedHaversine = Math.min(1, Math.max(0, haversine));
    return 6371 * 2 * Math.atan2(Math.sqrt(boundedHaversine), Math.sqrt(1 - boundedHaversine));
}

function findRecordedLocationCoordinates(query) {
    const normalizedQuery = normalizeLocationText(query);
    if (!normalizedQuery) return null;
    const candidates = [...state.lostReports, ...state.foundReports]
        .map(item => {
            const coordinates = getReportCoordinates(item);
            const recordedPlace = [item.placeName, item.locality, item.area]
                .some(field => normalizeLocationText(field) === normalizedQuery);
            return coordinates && recordedPlace ? { coordinates } : null;
        })
        .filter(Boolean);
    return candidates.length ? candidates[0].coordinates : null;
}

function getRecordedLocationSuggestions() {
    const seen = new Set();
    const suggestions = [];
    [...state.lostReports, ...state.foundReports].forEach(item => {
        const area = String(item.area || '').trim();
        const safeArea = area && !/(\b(?:house|h\.?\s*no\.?|flat|apartment|apt|door|plot|residence|street|st\.?|road|rd\.?|lane|floor|unit|building|bldg)\b|#\s*\d|\b\d{1,5}[/-]\d{1,5}\b)/i.test(area)
            ? area
            : '';
        const values = [
            item.placeName,
            item.locality,
            safeArea,
            [safeArea, item.city].filter(Boolean).join(', '),
            item.city,
            item.district,
            [item.city, item.state].filter(Boolean).join(', '),
            item.state
        ];
        values.forEach(value => {
            const label = String(value || '').trim();
            const normalized = normalizeLocationText(label);
            if (label && normalized && !seen.has(normalized)) {
                seen.add(normalized);
                suggestions.push(label);
            }
        });
    });
    return suggestions.sort((a, b) => a.localeCompare(b));
}

function syncDiscoveryControls() {
    const values = {
        'hero-location': discoveryFilters.location,
        'filter-location': discoveryFilters.location,
        'advanced-location': discoveryFilters.location,
        'hero-location-mode': discoveryFilters.mode,
        'browse-location-mode': discoveryFilters.mode,
        'advanced-location-mode': discoveryFilters.mode,
        'hero-location-radius': discoveryFilters.radius,
        'browse-location-radius': discoveryFilters.radius,
        'advanced-location-radius': discoveryFilters.radius,
        'filter-keyword': discoveryFilters.keyword,
        'advanced-keyword': discoveryFilters.keyword,
        'filter-category': discoveryFilters.category,
        'advanced-category': discoveryFilters.category,
        'filter-status': discoveryFilters.status,
        'advanced-status': discoveryFilters.status,
        'advanced-type': discoveryFilters.type,
        'browse-date-from': discoveryFilters.dateFrom,
        'advanced-date-from': discoveryFilters.dateFrom,
        'browse-date-to': discoveryFilters.dateTo,
        'advanced-date-to': discoveryFilters.dateTo,
        'browse-sort': discoveryFilters.sort,
        'advanced-sort': discoveryFilters.sort
    };
    Object.keys(values).forEach(id => {
        const control = document.getElementById(id);
        if (control && control.value !== values[id]) control.value = values[id];
    });

    const datalist = document.getElementById('recorded-locations');
    if (datalist) {
        datalist.innerHTML = getRecordedLocationSuggestions()
            .map(value => `<option value="${escapeHTML(value)}"></option>`)
            .join('');
    }
}

function updateDiscoveryFilter(filter, value) {
    discoveryFilters[filter] = value;
    if (filter === 'location' || filter === 'mode') {
        discoveryFilters.origin = null;
        discoveryFilters.originSource = '';
        discoveryFilters.originLabel = '';
    }
    if (filter === 'type') window.currentBrowseTypeFilter = value;
    syncDiscoveryControls();
    renderBrowseItems();
    renderAdvancedSearchResults();
}

function applyBrowseFilters() {
    const keyword = document.getElementById('filter-keyword');
    const category = document.getElementById('filter-category');
    const status = document.getElementById('filter-status');
    if (keyword) discoveryFilters.keyword = keyword.value;
    if (category) discoveryFilters.category = category.value;
    if (status) discoveryFilters.status = status.value;
    syncDiscoveryControls();
    renderBrowseItems();
    renderAdvancedSearchResults();
}

function getHighestMatchScore(item) {
    if (item.status !== 'Active') return null;
    const counterparts = (item.type === 'lost' ? state.foundReports : state.lostReports)
        .filter(report => report.status === 'Active');
    if (!counterparts.length) return null;
    const safeItem = Object.assign({}, item, {
        title: String(item.title || ''),
        category: String(item.category || ''),
        city: String(item.city || ''),
        area: String(item.area || ''),
        color: String(item.color || ''),
        date: item.date || '',
        description: String(item.description || '')
    });
    return Math.max(...counterparts.map(counterpart => {
        const safeCounterpart = Object.assign({}, counterpart, {
            title: String(counterpart.title || ''),
            category: String(counterpart.category || ''),
            city: String(counterpart.city || ''),
            area: String(counterpart.area || ''),
            color: String(counterpart.color || ''),
            date: counterpart.date || '',
            description: String(counterpart.description || '')
        });
        const match = item.type === 'lost'
            ? calculateMatchScore(safeItem, safeCounterpart)
            : calculateMatchScore(safeCounterpart, safeItem);
        return match.score;
    }));
}

function getDiscoveryResults() {
    let reports = [...state.lostReports, ...state.foundReports];
    if (discoveryFilters.type !== 'all') {
        reports = reports.filter(item => item.type === discoveryFilters.type);
    }
    if (discoveryFilters.keyword.trim()) {
        const keyword = normalizeLocationText(discoveryFilters.keyword);
        reports = reports.filter(item => normalizeLocationText(
            `${item.title || ''} ${item.description || ''} ${item.brand || ''}`
        ).includes(keyword));
    }
    if (discoveryFilters.category !== 'all') {
        reports = reports.filter(item => item.category === discoveryFilters.category);
    }
    if (discoveryFilters.status !== 'all') {
        reports = reports.filter(item => item.status === discoveryFilters.status);
    }
    if (discoveryFilters.dateFrom) reports = reports.filter(item => item.date >= discoveryFilters.dateFrom);
    if (discoveryFilters.dateTo) reports = reports.filter(item => item.date <= discoveryFilters.dateTo);

    const hasQuery = Boolean(discoveryFilters.location.trim());
    const hasOrigin = Boolean(discoveryFilters.origin);
    const radius = discoveryFilters.radius === 'exact' ? null : Number(discoveryFilters.radius);
    reports = reports.map(item => {
        const textMatch = hasQuery && locationTextMatches(item, discoveryFilters.location, discoveryFilters.mode);
        const coordinates = getReportCoordinates(item);
        const distanceKm = hasOrigin && coordinates
            ? haversineDistanceKm(discoveryFilters.origin, coordinates)
            : null;
        return { item, textMatch, distanceKm, coordinates };
    });

    if (hasQuery || hasOrigin) {
        reports = reports.filter(result => {
            if (radius === null) return result.textMatch;
            if (!hasOrigin) return result.textMatch;
            if (hasOrigin && result.distanceKm !== null && result.distanceKm <= radius) return true;
            return hasQuery && result.textMatch && !result.coordinates;
        });
    }
    if (discoveryFilters.sort === 'nearest' && hasOrigin) {
        reports.sort((a, b) => {
            if (a.distanceKm === null && b.distanceKm !== null) return 1;
            if (a.distanceKm !== null && b.distanceKm === null) return -1;
            return (a.distanceKm || 0) - (b.distanceKm || 0);
        });
    } else if (discoveryFilters.sort === 'match') {
        reports = reports.map(result => ({
            ...result,
            matchScore: getHighestMatchScore(result.item)
        })).sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
    }
    if (discoveryFilters.sort === 'newest' || (discoveryFilters.sort === 'nearest' && !hasOrigin)) {
        reports.sort((a, b) => new Date(b.item.createdAt || b.item.date) - new Date(a.item.createdAt || a.item.date));
    }
    if (discoveryFilters.sort !== 'match') {
        reports = reports.map(result => Object.assign(result, {
            matchScore: getHighestMatchScore(result.item)
        }));
    }
    return reports;
}

function updateLocationSearchStatus(results, prefix) {
    const status = document.getElementById(`${prefix}-location-status`);
    if (!status) return;
    const messages = [];
    const hasQuery = Boolean(discoveryFilters.location.trim());
    const radiusSearch = discoveryFilters.radius !== 'exact';
    if (hasQuery && radiusSearch && !discoveryFilters.origin) {
        messages.push('No coordinates are recorded for this search location. Showing matching location text; distances cannot be calculated.');
    } else if (radiusSearch && discoveryFilters.origin && discoveryFilters.originSource === 'gps') {
        messages.push('Reports without valid coordinates cannot be verified against this radius and are not included in the Near Me distance search.');
    } else if (radiusSearch && discoveryFilters.origin) {
        const textOnlyCount = results.filter(result => result.distanceKm === null && result.textMatch).length;
        if (textOnlyCount) messages.push(`${textOnlyCount} report(s) without coordinates are included because their recorded location text matches your search; no distance is shown for them.`);
    }
    if (discoveryFilters.sort === 'nearest' && !discoveryFilters.origin) {
        messages.push('Nearest-first sorting is unavailable until a selected report location has coordinates or you search Near Me.');
    }
    status.textContent = messages.join(' ');
    status.classList.toggle('hidden', messages.length === 0);
}

function renderDiscoveryResults(gridId, statusPrefix) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    const results = getDiscoveryResults();
    updateLocationSearchStatus(results, statusPrefix);
    if (statusPrefix === 'browse') {
        const count = document.getElementById('browse-result-count');
        if (count) count.textContent = `${results.length} ${results.length === 1 ? 'report' : 'reports'} found`;
    }
    if (!results.length) {
        grid.innerHTML = `
            <div class="col-span-full py-16 text-center bg-white rounded-2xl border border-gray-200">
                <i class="fa-solid fa-magnifying-glass text-4xl text-gray-300 mb-3"></i>
                <h4 class="font-bold text-gray-700">No reports match these filters</h4>
                <p class="text-xs text-gray-500 mt-1">Try a broader location or date range, or reset the filters.</p>
            </div>
        `;
        return;
    }
    grid.innerHTML = results.map(result => createDiscoveryCardHTML(result)).join('');
}

function renderBrowseItems() {
    renderDiscoveryResults('browse-items-grid', 'browse');
}

function renderAdvancedSearchResults() {
    renderDiscoveryResults('advanced-items-grid', 'advanced');
}

function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
}

function createDiscoveryCardHTML(result) {
    const item = result.item;
    const isLost = item.type === 'lost';
    const location = getApproximateLocation(item);
    const distance = result.distanceKm === null ? '' : `<span class="text-[11px] text-brand-700 font-semibold">~${result.distanceKm.toFixed(1)} km away</span>`;
    const match = result.matchScore === null ? '' : `<span class="text-[11px] text-amber-700 font-semibold">${result.matchScore}% possible match</span>`;
    const image = item.photoUrl || 'https://placehold.co/400x300/1b4332/ffffff?text=No+Photo';
    return `
        <article class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition flex flex-col">
            <div class="relative h-44 bg-gray-100">
                <img src="${escapeHTML(image)}" alt="${escapeHTML(item.title || 'Reported item')}" class="w-full h-full object-cover">
                <span class="absolute top-3 left-3 ${isLost ? 'bg-red-600' : 'bg-brand-600'} text-white text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-full">${isLost ? 'Lost' : 'Found'}</span>
            </div>
            <div class="p-4 space-y-2 flex-grow">
                <h3 class="font-bold text-sm text-gray-900 truncate" title="${escapeHTML(item.title)}">${escapeHTML(item.title || 'Untitled item')}</h3>
                <p class="text-[11px] text-gray-500">${escapeHTML(item.category || 'Uncategorized')}</p>
                <div class="flex items-start gap-1 text-[11px] text-gray-600">
                    <i class="fa-solid fa-location-dot text-brand-600 mt-0.5"></i>
                    <span>Approx. ${escapeHTML(location)}</span>
                </div>
                <p class="text-xs text-gray-600 line-clamp-2">${escapeHTML(item.description || '')}</p>
                <div class="flex flex-wrap gap-x-3 gap-y-1">${distance}${match}</div>
            </div>
            <div class="p-4 pt-0 border-t border-gray-100 mt-2 flex justify-between items-center text-xs">
                <span class="text-[10px] text-gray-500">${escapeHTML(item.date || '')}</span>
                <button onclick="openItemDetail('${escapeHTML(item.id)}')" class="text-brand-700 font-bold hover:underline">View Details &rarr;</button>
            </div>
        </article>
    `;
}

function createItemCardHTML(item) {
    const isLost = item.type === 'lost';
    const badgeBg = isLost ? 'bg-red-600' : 'bg-brand-600';

    return `
        <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition flex flex-col justify-between">
            <div>
                <div class="relative h-44 bg-gray-100">
                    <img src="${escapeHTML(item.photoUrl || 'https://placehold.co/400x300/173b70/ffffff?text=TrackFound')}" alt="${escapeHTML(item.title || 'Reported item')}" class="w-full h-full object-cover" loading="lazy">
                    <span class="absolute top-3 left-3 ${badgeBg} text-white text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-full shadow">
                        ${escapeHTML(item.type)}
                    </span>
                    <span class="status-pill absolute top-3 right-3">
                        ${escapeHTML(item.status || 'Active')}
                    </span>
                </div>

                <div class="p-4 space-y-2">
                    <h3 class="font-bold text-sm text-gray-900 truncate" title="${escapeHTML(item.title)}">${escapeHTML(item.title || 'Untitled item')}</h3>
                    <div class="flex items-center space-x-1 text-[11px] text-gray-500">
                        <i class="fa-solid fa-location-dot text-brand-600"></i>
                        <span>Approx. ${escapeHTML(getApproximateLocation(item))}</span>
                    </div>
                    <p class="text-xs text-gray-600 line-clamp-2 leading-relaxed">${escapeHTML(item.description || '')}</p>
                </div>
            </div>

            <div class="p-4 pt-0 border-t border-gray-100 mt-3 flex justify-between items-center text-xs">
                <span class="text-[10px] text-gray-400 font-medium">${escapeHTML(item.date || '')}</span>
                <button onclick="openItemDetail('${escapeHTML(item.id)}')" class="text-brand-700 font-bold hover:underline">View Details &rarr;</button>
            </div>
        </div>
    `;
}

/* ==========================================================================
   MATCHES RENDERER
   ========================================================================== */

function renderSmartMatches() {
    const list = document.getElementById('matches-list');
    const matches = getMatchesForUser();

    if (matches.length === 0) {
        list.innerHTML = `
            <div class="p-16 text-center bg-white rounded-2xl border border-gray-200">
                <i class="fa-solid fa-diagram-next text-5xl text-gray-300 mb-3"></i>
                <h4 class="font-bold text-gray-700">No matches found between active reports</h4>
                <p class="text-xs text-gray-400 mt-1 max-w-md mx-auto">When lost and found listings share category, location, color, and dates, algorithm match cards will automatically appear here.</p>
            </div>
        `;
        return;
    }

    list.innerHTML = matches.map(m => {
        let matchTagBg = 'bg-amber-500';
        let matchLabel = 'Possible Match';
        if (m.score >= 80) {
            matchTagBg = 'bg-green-600';
            matchLabel = 'Strong Match';
        } else if (m.score < 60) {
            matchTagBg = 'bg-gray-500';
            matchLabel = 'Low Match';
        }

        return `
            <div class="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-gray-100 pb-3">
                    <div class="flex items-center space-x-3">
                        <span class="${matchTagBg} text-white font-black text-sm px-3 py-1 rounded-full shadow">
                            ${m.score}% Match
                        </span>
                        <span class="font-bold text-xs text-gray-700 uppercase tracking-wider">${matchLabel}</span>
                    </div>
                    <span class="text-xs text-gray-400">Automated Scoring Result</span>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <!-- Lost Card -->
                    <div class="bg-red-50/50 border border-red-100 p-4 rounded-xl space-y-2">
                        <span class="bg-red-600 text-white text-[9px] font-bold px-2 py-0.5 rounded">LOST ITEM</span>
                        <h4 class="font-bold text-sm text-gray-900">${m.lost.title}</h4>
                        <p class="text-xs text-gray-600">${m.lost.description}</p>
                        <div class="text-[11px] text-gray-500 space-y-1 pt-1">
                            <div><strong>Approx. location:</strong> ${escapeHTML(getApproximateLocation(m.lost))}</div>
                            <div><strong>Date:</strong> ${m.lost.date} | <strong>Color:</strong> ${m.lost.color}</div>
                        </div>
                    </div>

                    <!-- Found Card -->
                    <div class="bg-brand-50/50 border border-brand-100 p-4 rounded-xl space-y-2">
                        <span class="bg-brand-600 text-white text-[9px] font-bold px-2 py-0.5 rounded">FOUND ITEM</span>
                        <h4 class="font-bold text-sm text-gray-900">${m.found.title}</h4>
                        <p class="text-xs text-gray-600">${m.found.description}</p>
                        <div class="text-[11px] text-gray-500 space-y-1 pt-1">
                            <div><strong>Approx. location:</strong> ${escapeHTML(getApproximateLocation(m.found))}</div>
                            <div><strong>Date:</strong> ${m.found.date} | <strong>Color:</strong> ${m.found.color}</div>
                        </div>
                    </div>
                </div>

                <div class="pt-2 flex justify-end space-x-3">
                    <button onclick="openItemDetail('${m.found.id}')" class="bg-brand-700 hover:bg-brand-800 text-white font-bold px-4 py-2 rounded-xl text-xs">
                        Review & Claim Item &rarr;
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/* ==========================================================================
   USER DASHBOARD RENDERER
   ========================================================================== */

function renderDashboard() {
    if (!state.currentUser) return;

    document.getElementById('dash-user-name').innerText = state.currentUser.name;
    document.getElementById('dash-user-email').innerText = `${state.currentUser.email} (${state.currentUser.role.toUpperCase()})`;
    document.getElementById('dash-user-avatar').innerText = state.currentUser.name.charAt(0).toUpperCase();

    // Render My Reports
    const repGrid = document.getElementById('user-reports-grid');
    const allMyReports = [...state.lostReports, ...state.foundReports]
        .filter(report => report.userId === state.currentUser.id)
        .sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    const myLostReports = allMyReports.filter(report => report.type === 'lost');
    const myFoundReports = allMyReports.filter(report => report.type === 'found');
    const myClaims = state.claims.filter(claim => claim.claimantId === state.currentUser.id);
    document.getElementById('dash-total-count').innerText = allMyReports.length;
    document.getElementById('dash-lost-count').innerText = myLostReports.length;
    document.getElementById('dash-found-count').innerText = myFoundReports.length;
    document.getElementById('dash-claims-count').innerText = myClaims.length;
    const myReps = myReportsFilter === 'all'
        ? allMyReports
        : allMyReports.filter(report => report.type === myReportsFilter);

    if (myReps.length === 0) {
        repGrid.innerHTML = `
            <div class="col-span-full p-12 text-center bg-white rounded-2xl border border-gray-200">
                <i class="fa-solid fa-folder-open text-4xl text-gray-300 mb-3"></i>
                <h4 class="font-bold text-gray-700">${allMyReports.length ? 'No reports in this filter' : "You haven't posted any reports yet"}</h4>
                <p class="text-xs text-gray-500 mt-1">${allMyReports.length ? 'Choose another report type to see your listings.' : 'Create a report to keep track of it here.'}</p>
                ${allMyReports.length ? '' : '<button onclick="openReportModal(\'lost\')" class="mt-4 px-4 py-2 bg-brand-700 text-white rounded-xl text-xs font-bold">Create a report</button>'}
            </div>
        `;
    } else {
        repGrid.innerHTML = myReps.map(r => `
            <article class="dashboard-report-card bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div class="h-36 bg-gray-100">
                    <img src="${escapeHTML(r.photoUrl || 'https://placehold.co/600x360/173b70/ffffff?text=TrackFound')}" alt="${escapeHTML(r.title)}" class="w-full h-full object-cover" loading="lazy">
                </div>
                <div class="p-4 space-y-3">
                <div class="flex justify-between items-center">
                    <span class="status-pill ${r.type === 'lost' ? 'is-lost' : 'is-found'}">${escapeHTML(r.type)}</span>
                    <span class="status-pill is-neutral">${escapeHTML(r.status || 'Active')}</span>
                </div>
                <div>
                    <h4 class="font-bold text-sm text-gray-900 truncate" title="${escapeHTML(r.title)}">${escapeHTML(r.title)}</h4>
                    <p class="text-xs text-gray-500 mt-1">${escapeHTML(r.category || 'Other')} &middot; ${escapeHTML(r.date || '')}</p>
                </div>
                <p class="text-xs text-gray-600 line-clamp-2">${escapeHTML(r.description || '')}</p>
                <p class="text-[11px] text-gray-500"><i class="fa-solid fa-location-dot text-brand-600 mr-1"></i>Approx. ${escapeHTML(getApproximateLocation(r))}</p>
                <div class="pt-3 border-t border-gray-100 flex flex-wrap justify-between items-center gap-2 text-xs">
                    <button onclick="editReport('${escapeHTML(r.id)}')" class="text-brand-700 hover:underline font-semibold"><i class="fa-regular fa-pen-to-square mr-1"></i>Edit</button>
                    <button onclick="deleteReport('${escapeHTML(r.id)}')" class="text-red-600 hover:underline font-semibold"><i class="fa-regular fa-trash-can mr-1"></i>Delete</button>
                    <button onclick="openItemDetail('${escapeHTML(r.id)}')" class="text-brand-700 hover:underline font-bold">Details</button>
                </div>
                </div>
            </article>
        `).join('');
    }

    const activity = document.getElementById('my-recent-activity');
    activity.innerHTML = allMyReports.slice(0, 4).map(report => `
        <div class="flex items-center justify-between gap-3 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
            <span class="min-w-0 truncate text-gray-700"><i class="fa-solid fa-circle ${report.type === 'lost' ? 'text-red-500' : 'text-brand-600'} text-[7px] mr-2"></i>${escapeHTML(report.type === 'lost' ? 'Lost report' : 'Found report')}: ${escapeHTML(report.title)}</span>
            <span class="shrink-0 text-gray-400">${escapeHTML(report.date || '')}</span>
        </div>
    `).join('') || '<p class="text-gray-400">Your recent reports and updates will appear here.</p>';

    // Render Claims Submitted
    const claimsSubList = document.getElementById('claims-submitted-list');
    if (myClaims.length === 0) {
        claimsSubList.innerHTML = `<div class="text-center text-gray-400 py-6">No claim requests submitted yet</div>`;
    } else {
        claimsSubList.innerHTML = myClaims.map(c => `
            <div class="p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-1">
                <div class="flex justify-between font-bold">
                    <span>Item Claim: ${c.itemId}</span>
                    <span class="px-2 py-0.5 rounded text-[10px] ${c.status === 'Approved' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}">${c.status}</span>
                </div>
                <p class="text-gray-600">Reason: ${c.reason}</p>
            </div>
        `).join('');
    }

    // Render Claims Received
    const claimsRecList = document.getElementById('claims-received-list');
    const myFoundItemIds = state.foundReports.filter(f => f.userId === state.currentUser.id).map(f => f.id);
    const recClaims = state.claims.filter(c => myFoundItemIds.includes(c.itemId));

    if (recClaims.length === 0) {
        claimsRecList.innerHTML = `<div class="text-center text-gray-400 py-6">No claims received for your found items</div>`;
    } else {
        claimsRecList.innerHTML = recClaims.map(c => `
            <div class="p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-2">
                <div class="flex justify-between font-bold">
                    <span>Claimant: ${c.claimantName}</span>
                    <span class="px-2 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800">${c.status}</span>
                </div>
                <p class="text-gray-600">Proof Answer: "${c.secretAnswer}"</p>
                <p class="text-gray-500">Reason: ${c.reason}</p>
                ${c.status === 'Pending' ? `
                    <div class="flex space-x-2 pt-2">
                        <button onclick="updateClaimStatus('${c.id}', 'Approved')" class="bg-green-600 text-white px-3 py-1 rounded-lg font-bold">Approve</button>
                        <button onclick="updateClaimStatus('${c.id}', 'Rejected')" class="bg-red-600 text-white px-3 py-1 rounded-lg font-bold">Reject</button>
                    </div>
                ` : ''}
            </div>
        `).join('');
    }

    // Render Chat Threads
    renderChatThreads();
}

/* ==========================================================================
   MESSAGING & CHAT SYSTEM LOGIC
   ========================================================================== */

function renderChatThreads() {
    const threadsContainer = document.getElementById('chat-threads-list');
    if (!state.currentUser) return;

    // Find all unique thread partners
    const userMsgs = state.messages.filter(m => m.senderId === state.currentUser.id || m.receiverId === state.currentUser.id);
    const partnerIds = [...new Set(userMsgs.map(m => m.senderId === state.currentUser.id ? m.receiverId : m.senderId))];

    if (partnerIds.length === 0) {
        threadsContainer.innerHTML = `<div class="text-center text-gray-400 py-6">No active messages</div>`;
        return;
    }

    threadsContainer.innerHTML = partnerIds.map(partnerId => {
        const partner = state.users.find(u => u.id === partnerId) || { name: 'Community Member' };
        return `
            <button onclick="selectChatThread('${partnerId}')" class="w-full text-left p-2.5 rounded-xl border border-gray-100 hover:bg-brand-50 flex items-center space-x-2">
                <div class="w-7 h-7 rounded-full bg-brand-700 text-white flex items-center justify-center font-bold text-xs">
                    ${partner.name.charAt(0)}
                </div>
                <span class="font-bold text-gray-800 truncate">${partner.name}</span>
            </button>
        `;
    }).join('');
}

function selectChatThread(partnerId) {
    activeChatThreadKey = partnerId;
    const partner = state.users.find(u => u.id === partnerId) || { name: 'Community Member' };
    document.getElementById('chat-header').innerHTML = `<span class="text-gray-900 font-bold">Conversation with ${partner.name}</span>`;
    renderActiveChatMessages();
}

function renderActiveChatMessages() {
    if (!activeChatThreadKey || !state.currentUser) return;
    const container = document.getElementById('chat-messages-container');

    const msgs = state.messages.filter(m => 
        (m.senderId === state.currentUser.id && m.receiverId === activeChatThreadKey) ||
        (m.senderId === activeChatThreadKey && m.receiverId === state.currentUser.id)
    ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    container.innerHTML = msgs.map(m => {
        const isMe = m.senderId === state.currentUser.id;
        return `
            <div class="flex ${isMe ? 'justify-end' : 'justify-start'}">
                <div class="${isMe ? 'bg-brand-700 text-white rounded-br-none' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none'} max-w-xs p-3 rounded-2xl shadow-sm space-y-1">
                    <p class="text-xs leading-relaxed">${m.text}</p>
                    <span class="text-[9px] block text-right opacity-70">${new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
            </div>
        `;
    }).join('');

    container.scrollTop = container.scrollHeight;
}

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = redactSensitiveInput(input.value.trim());

    if (!text || !activeChatThreadKey || !state.currentUser) return;

    state.messages.push({
        id: 'msg_' + Date.now(),
        senderId: state.currentUser.id,
        receiverId: activeChatThreadKey,
        text: text,
        timestamp: new Date().toISOString()
    });

    input.value = '';
    saveState();          // persist new chat message
    renderActiveChatMessages();
}

/* ==========================================================================
   ADMIN PORTAL RENDERER & LOGIC
   ========================================================================== */

function renderAdminPortal() {
    document.getElementById('admin-user-count').innerText = state.users.length;
    document.getElementById('admin-flag-count').innerText = state.abuseReports.length;

    // Render users
    const usersList = document.getElementById('admin-users-list');
    if (state.users.length === 0) {
        usersList.innerHTML = `<div class="text-center text-gray-400 py-4">No registered users</div>`;
    } else {
        usersList.innerHTML = state.users.map(u => `
            <div class="flex justify-between items-center p-2.5 bg-gray-50 rounded-xl border border-gray-100">
                <div>
                    <div class="font-bold text-gray-800">${u.name}</div>
                    <div class="text-[10px] text-gray-400">${u.email}</div>
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${u.status === 'Suspended' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}">${u.status || 'Active'}</span>
            </div>
        `).join('');
    }

    // Render Listings Table
    const tbody = document.getElementById('admin-listings-table');
    const allItems = [...state.lostReports, ...state.foundReports];

    if (allItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-gray-400">No database reports created yet</td></tr>`;
        return;
    }

    tbody.innerHTML = allItems.map(item => `
        <tr class="hover:bg-gray-50">
            <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${item.type === 'lost' ? 'bg-red-100 text-red-700' : 'bg-brand-100 text-brand-700'}">${item.type}</span></td>
            <td class="p-3 font-bold text-gray-800">${item.title}</td>
            <td class="p-3">${item.category}</td>
            <td class="p-3">${item.userEmail || 'Anonymous'}</td>
            <td class="p-3">${item.date}</td>
            <td class="p-3">${item.status}</td>
            <td class="p-3 text-right">
                <button onclick="deleteReport('${item.id}')" class="text-red-600 font-bold hover:underline">Remove</button>
            </td>
        </tr>
    `).join('');
}

/* ==========================================================================
   FORM SUBMISSIONS & ACTIONS
   ========================================================================== */

function handleReportSubmit(e) {
    e.preventDefault();
    if (!state.currentUser) {
        showToast("Please log in first to submit a report.", "error");
        openAuthModal('login');
        return;
    }
    const existingReport = editingReportId
        ? [...state.lostReports, ...state.foundReports].find(report => report.id === editingReportId)
        : null;
    if (editingReportId && (!existingReport ||
        (existingReport.userId !== state.currentUser.id && state.currentUser.role !== 'admin'))) {
        showToast("You aren't authorized to edit this report.", "error");
        closeModal('report-modal');
        return;
    }

    const latitudeInput = document.getElementById('rep-latitude').value.trim();
    const longitudeInput = document.getElementById('rep-longitude').value.trim();
    if (Boolean(latitudeInput) !== Boolean(longitudeInput)) {
        showToast("Enter both latitude and longitude, or leave both blank.", "error");
        return;
    }
    const latitude = latitudeInput ? Number(latitudeInput) : null;
    const longitude = longitudeInput ? Number(longitudeInput) : null;
    if (latitudeInput && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
        showToast("Enter valid latitude and longitude coordinates.", "error");
        return;
    }

    const type = document.getElementById('report-form-type').value;
    const reportFields = {
        type: type,
        title: redactSensitiveInput(document.getElementById('rep-title').value.trim()),
        category: document.getElementById('rep-category').value,
        color: redactSensitiveInput(document.getElementById('rep-color').value.trim()),
        brand: redactSensitiveInput(document.getElementById('rep-brand').value.trim()),
        date: document.getElementById('rep-date').value,
        country: document.getElementById('rep-country').value.trim(),
        state: document.getElementById('rep-state').value.trim(),
        district: document.getElementById('rep-district').value.trim(),
        city: document.getElementById('rep-city').value.trim(),
        area: document.getElementById('rep-area').value.trim(),
        locality: document.getElementById('rep-locality').value.trim(),
        placeName: document.getElementById('rep-place-name').value.trim(),
        latitude,
        longitude,
        contact: document.getElementById('rep-contact').value.trim(),
        description: redactSensitiveInput(document.getElementById('rep-desc').value.trim()),
        privateDetail: redactSensitiveInput(document.getElementById('rep-private-detail').value.trim()),
        photoUrl: imageRemovedForEdit ? null : (currentImagePreviewBase64 || (existingReport && existingReport.photoUrl) || null)
    };

    if (existingReport) {
        Object.assign(existingReport, reportFields);
    } else {
        const newReport = Object.assign({
            id: (type === 'lost' ? 'LST_' : 'FND_') + Date.now(),
            userId: state.currentUser.id,
            userEmail: state.currentUser.email,
            status: 'Active',
            createdAt: new Date().toISOString()
        }, reportFields);
        (type === 'lost' ? state.lostReports : state.foundReports).push(newReport);
    }

    closeModal('report-modal');
    document.getElementById('report-form').reset();
    removeImagePreview();
    showToast(`${type.toUpperCase()} report ${existingReport ? 'updated' : 'published'} successfully!`, "success");
    renderAllViews();
}

function handleClaimSubmit(e) {
    e.preventDefault();
    if (!state.currentUser) {
        showToast("Please log in to claim an item.", "error");
        openAuthModal('login');
        return;
    }

    const itemId = document.getElementById('claim-item-id').value;
    const foundItem = state.foundReports.find(item => item.id === itemId && item.status === 'Active');
    if (!foundItem || foundItem.userId === state.currentUser.id) {
        showToast("This found item is no longer available for a claim.", "error");
        return;
    }
    if (state.claims.some(claim => claim.itemId === itemId &&
        claim.claimantId === state.currentUser.id && claim.status === 'Pending')) {
        showToast("You already have a pending claim for this item.", "info");
        return;
    }
    const claim = {
        id: 'clm_' + Date.now(),
        itemId: itemId,
        claimantId: state.currentUser.id,
        claimantName: state.currentUser.name,
        reason: redactSensitiveInput(document.getElementById('claim-reason').value.trim()),
        secretAnswer: redactSensitiveInput(document.getElementById('claim-secret-answer').value.trim()),
        status: 'Pending',
        createdAt: new Date().toISOString()
    };

    state.claims.push(claim);
    closeModal('item-detail-modal');
    showToast("Ownership claim submitted for review!", "success");
    renderAllViews();
}

function updateClaimStatus(claimId, newStatus) {
    const c = state.claims.find(x => x.id === claimId);
    const item = c && state.foundReports.find(report => report.id === c.itemId);
    if (c && item && state.currentUser &&
        (item.userId === state.currentUser.id || state.currentUser.role === 'admin') &&
        ['Approved', 'Rejected'].includes(newStatus)) {
        c.status = newStatus;
        showToast(`Claim marked as ${newStatus}`, "info");
        renderAllViews();
    } else {
        showToast("You aren't authorized to update this claim.", "error");
    }
}

function deleteReport(id) {
    const report = [...state.lostReports, ...state.foundReports].find(item => item.id === id);
    if (!report || !state.currentUser ||
        (report.userId !== state.currentUser.id && state.currentUser.role !== 'admin')) {
        showToast("You aren't authorized to delete this report.", "error");
        return;
    }
    if (!confirm(`Delete the report "${report.title}"? This cannot be undone.`)) return;
    state.lostReports = state.lostReports.filter(item => item.id !== id);
    state.foundReports = state.foundReports.filter(item => item.id !== id);
    state.claims = state.claims.filter(claim => claim.itemId !== id);
    showToast("Report deleted from this browser.", "success");
    renderAllViews();
}

function editReport(id) {
    const report = [...state.lostReports, ...state.foundReports].find(item => item.id === id);
    if (!report || !state.currentUser ||
        (report.userId !== state.currentUser.id && state.currentUser.role !== 'admin')) {
        showToast("You aren't authorized to edit this report.", "error");
        return;
    }
    editingReportId = id;
    openReportModal(report.type, true);
    const fields = {
        'rep-title': report.title,
        'rep-category': report.category,
        'rep-color': report.color,
        'rep-brand': report.brand,
        'rep-date': report.date,
        'rep-country': report.country,
        'rep-state': report.state,
        'rep-city': report.city,
        'rep-area': report.area,
        'rep-district': report.district,
        'rep-locality': report.locality,
        'rep-place-name': report.placeName,
        'rep-latitude': report.latitude,
        'rep-longitude': report.longitude,
        'rep-contact': report.contact,
        'rep-desc': report.description,
        'rep-private-detail': report.privateDetail
    };
    Object.keys(fields).forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = fields[id] == null ? '' : fields[id];
    });
    document.getElementById('rep-file').value = '';
    currentImagePreviewBase64 = report.photoUrl || null;
    const previewBox = document.getElementById('image-preview-box');
    if (currentImagePreviewBase64) {
        document.getElementById('image-preview-img').src = currentImagePreviewBase64;
        previewBox.classList.remove('hidden');
    } else {
        previewBox.classList.add('hidden');
    }
}

/* ==========================================================================
   AUTHENTICATION LOGIC
   ========================================================================== */

async function deriveLocalPasswordHash(password, saltHex) {
    if (!window.crypto || !window.crypto.subtle || !window.crypto.getRandomValues) {
        throw new Error('Secure browser cryptography is unavailable.');
    }
    const salt = saltHex
        ? Uint8Array.from(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)))
        : window.crypto.getRandomValues(new Uint8Array(16));
    const key = await window.crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const hash = await window.crypto.subtle.deriveBits({
        name: 'PBKDF2',
        salt,
        iterations: 120000,
        hash: 'SHA-256'
    }, key, 256);
    return {
        passwordSalt: Array.from(salt, byte => byte.toString(16).padStart(2, '0')).join(''),
        passwordHash: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
    };
}

async function handleRegisterSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim().toLowerCase();
    const phone = document.getElementById('reg-phone').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirmation = document.getElementById('reg-password-confirm').value;

    if (name.length < 2) {
        showToast("Enter your name using at least 2 characters.", "error");
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showToast("Enter a valid email address.", "error");
        return;
    }
    if (!/^[0-9+() .-]{7,20}$/.test(phone)) {
        showToast("Enter a valid phone number.", "error");
        return;
    }
    if (password.length < 8) {
        showToast("Use a password with at least 8 characters.", "error");
        return;
    }
    if (password !== confirmation) {
        showToast("The passwords do not match.", "error");
        return;
    }
    if (state.users.some(user => String(user.email || '').toLowerCase() === email)) {
        showToast("An account with this email already exists. Please log in.", "error");
        return;
    }

    const submitButton = document.querySelector('#auth-register-form button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Creating account...';
    try {
        const passwordCredential = await deriveLocalPasswordHash(password);
        const newUser = {
            id: 'usr_' + Date.now(),
            name, email, phone,
            ...passwordCredential,
            role: 'user',
            status: 'Active'
        };

        state.users.push(newUser);
        state.currentUser = newUser;
        document.getElementById('auth-register-form').reset();
        closeModal('auth-modal');
        showToast("Account created on this device.", "success");
        renderAllViews();
    } catch (error) {
        console.error('Local account creation failed:', error);
        showToast("Couldn't create a local account with this browser. Check browser security settings and try again.", "error");
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Create account';
    }
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    const user = state.users.find(u => String(u.email || '').toLowerCase() === email);
    if (!user) {
        showToast("No account exists for this email on this device. Register first.", "error");
        return;
    }

    const submitButton = document.querySelector('#auth-login-form button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Signing in...';
    try {
        if (user.passwordSalt && user.passwordHash) {
            const credential = await deriveLocalPasswordHash(password, user.passwordSalt);
            if (credential.passwordHash !== user.passwordHash) {
                showToast("That password doesn't match this local account.", "error");
                return;
            }
        } else {
            // Older local accounts predate password fields; keep their saved reports and add a local credential.
            Object.assign(user, await deriveLocalPasswordHash(password));
        }
        state.currentUser = user;
        document.getElementById('auth-login-form').reset();
        closeModal('auth-modal');
        showToast(`Welcome back, ${user.name}!`, "success");
        renderAllViews();
    } catch (error) {
        console.error('Local sign-in failed:', error);
        showToast("Couldn't verify this local account. Check browser security settings and try again.", "error");
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Log in';
    }
}

function logoutUser() {
    state.currentUser = null;
    showToast("Logged out safely.", "info");
    navTo('home');
}

function toggleUserRole(role) {
    if (state.currentUser) {
        state.currentUser.role = role;
        renderAllViews();
    }
}

function updateAuthUI() {
    const unlogged = document.getElementById('auth-buttons-unlogged');
    const logged = document.getElementById('auth-buttons-logged');
    const adminBtn = document.getElementById('admin-portal-btn');

    if (state.currentUser) {
        unlogged.classList.add('hidden');
        logged.classList.remove('hidden');
        document.getElementById('user-name-display').innerText = state.currentUser.name;
        document.getElementById('user-avatar-text').innerText = state.currentUser.name.charAt(0).toUpperCase();

        if (state.currentUser.role === 'admin') {
            adminBtn.classList.remove('hidden');
        } else {
            adminBtn.classList.add('hidden');
        }
    } else {
        unlogged.classList.remove('hidden');
        logged.classList.add('hidden');
        adminBtn.classList.add('hidden');
    }
}

/* ==========================================================================
   MODAL & TOAST HELPERS
   ========================================================================== */

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
    if (id === 'report-modal') {
        editingReportId = null;
        imageRemovedForEdit = false;
        document.getElementById('report-submit-button').textContent = 'Publish Report';
        document.getElementById('report-modal-title').textContent = 'Submit Report';
    }
}

function openReportModal(type, keepForm = false) {
    if (!state.currentUser) {
        showToast("Please log in to report items.", "error");
        openAuthModal('login');
        return;
    }

    if (!keepForm) {
        editingReportId = null;
        imageRemovedForEdit = false;
        currentImagePreviewBase64 = null;
        document.getElementById('report-form').reset();
        document.getElementById('image-preview-box').classList.add('hidden');
        document.getElementById('rep-file').value = '';
        document.getElementById('report-submit-button').textContent = 'Publish Report';
    }

    document.getElementById('report-form-type').value = type;
    const header = document.getElementById('report-modal-header');
    const title = document.getElementById('report-modal-title');
    const lblDate = document.getElementById('lbl-rep-date');

    if (type === 'lost') {
        header.className = "p-5 bg-red-600 text-white flex justify-between items-center";
        title.innerText = "Publish Lost Report";
        lblDate.innerText = "Date Lost *";
    } else {
        header.className = "p-5 bg-brand-700 text-white flex justify-between items-center";
        title.innerText = "Publish Found Report";
        lblDate.innerText = "Date Found *";
    }
    if (keepForm) {
        title.innerText = type === 'lost' ? 'Edit Lost Report' : 'Edit Found Report';
        document.getElementById('report-submit-button').textContent = 'Save changes';
    }

    openModal('report-modal');
}

function openItemDetail(id) {
    const item = [...state.lostReports, ...state.foundReports].find(r => r.id === id);
    if (!item) return;

    document.getElementById('det-title').innerText = item.title;
    document.getElementById('det-category').innerText = item.category;
    document.getElementById('det-color').innerText = item.color;
    document.getElementById('det-brand').innerText = item.brand || 'N/A';
    document.getElementById('det-date').innerText = item.date;
    document.getElementById('det-location').innerText = `Approx. ${getApproximateLocation(item)}`;
    document.getElementById('det-contact').innerText = item.contact || 'Not provided';
    document.getElementById('det-desc').innerText = item.description;
    document.getElementById('det-img').src = item.photoUrl || 'https://placehold.co/400x300/1b4332/ffffff?text=No+Photo';

    const badge = document.getElementById('det-type-badge');
    badge.innerText = item.type;
    badge.className = item.type === 'lost' ? 'px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-red-600' : 'px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-brand-600';

    // Show claim section if logged in and not owner
    const claimBlock = document.getElementById('claim-section-block');
    if (item.type === 'found' && state.currentUser && state.currentUser.id !== item.userId) {
        claimBlock.classList.remove('hidden');
        document.getElementById('claim-item-id').value = item.id;
    } else {
        claimBlock.classList.add('hidden');
    }

    openModal('item-detail-modal');
}

function openAuthModal(tab) {
    switchAuthTab(tab);
    openModal('auth-modal');
}

function switchAuthTab(tab) {
    const loginForm = document.getElementById('auth-login-form');
    const regForm = document.getElementById('auth-register-form');
    const title = document.getElementById('auth-modal-title');

    if (tab === 'login') {
        loginForm.classList.remove('hidden');
        regForm.classList.add('hidden');
        title.innerText = "Log In to Trackfound";
    } else {
        loginForm.classList.add('hidden');
        regForm.classList.remove('hidden');
        title.innerText = "Create Account";
    }
}

function togglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    if (!input || !button) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    button.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    button.innerHTML = `<i class="fa-regular ${isPassword ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
}

function previewImageUpload(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            currentImagePreviewBase64 = e.target.result;
            document.getElementById('image-preview-img').src = e.target.result;
            document.getElementById('image-preview-box').classList.remove('hidden');
        }
        reader.readAsDataURL(input.files[0]);
    }
}

function removeImagePreview() {
    if (editingReportId) imageRemovedForEdit = true;
    currentImagePreviewBase64 = null;
    document.getElementById('rep-file').value = '';
    document.getElementById('image-preview-box').classList.add('hidden');
}

function setFilterReportType(type) {
    window.currentBrowseTypeFilter = type;
    discoveryFilters.type = type;
    ['all', 'lost', 'found'].forEach(t => {
        const btn = document.getElementById(`btn-type-${t}`);
        if (t === type) {
            btn.className = "px-4 py-2 text-xs font-bold rounded-xl border border-gray-300 bg-brand-700 text-white";
        } else {
            btn.className = "px-4 py-2 text-xs font-bold rounded-xl border border-gray-300 bg-white text-gray-700 hover:bg-gray-50";
        }
    });
    syncDiscoveryControls();
    applyBrowseFilters();
}

function applyBrowseFilters() {
    const keyword = document.getElementById('filter-keyword');
    const category = document.getElementById('filter-category');
    const status = document.getElementById('filter-status');
    if (keyword) discoveryFilters.keyword = keyword.value;
    if (category) discoveryFilters.category = category.value;
    if (status) discoveryFilters.status = status.value;
    syncDiscoveryControls();
    renderBrowseItems();
    renderAdvancedSearchResults();
}

function executeHeroSearch() {
    const q = document.getElementById('hero-search-query').value;
    const cat = document.getElementById('hero-search-category').value;

    discoveryFilters.keyword = q;
    discoveryFilters.category = cat || 'all';
    syncDiscoveryControls();

    navTo('browse');
}

function browseCategory(category) {
    discoveryFilters.category = category;
    discoveryFilters.keyword = '';
    syncDiscoveryControls();
    navTo('browse');
}

function submitLocationSearch(source) {
    const locationInput = document.getElementById(source === 'hero' ? 'hero-location' :
        source === 'advanced' ? 'advanced-location' : 'filter-location');
    if (locationInput) discoveryFilters.location = locationInput.value.trim();
    discoveryFilters.origin = findRecordedLocationCoordinates(discoveryFilters.location);
    discoveryFilters.originSource = discoveryFilters.origin ? 'selected' : '';
    discoveryFilters.originLabel = discoveryFilters.origin ? discoveryFilters.location : '';
    syncDiscoveryControls();
    if (source === 'hero') {
        navTo('browse');
    } else {
        renderBrowseItems();
        renderAdvancedSearchResults();
    }
}

function setNearMeLoading(source, loading) {
    const button = document.getElementById(`${source}-near-me`);
    if (!button) return;
    if (loading) {
        button.dataset.originalContent = button.innerHTML;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'Getting location...';
    } else {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        if (button.dataset.originalContent) {
            button.innerHTML = button.dataset.originalContent;
            delete button.dataset.originalContent;
        }
    }
}

function searchNearMe(source) {
    if (!navigator.geolocation) {
        showToast("This browser does not support location access. You can still search by typing a location.", "error");
        return;
    }
    setNearMeLoading(source, true);
    navigator.geolocation.getCurrentPosition(position => {
        setNearMeLoading(source, false);
        const latitude = Number(position.coords.latitude);
        const longitude = Number(position.coords.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
            latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            showToast("The browser returned invalid location coordinates. Try a manual location search.", "error");
            return;
        }
        discoveryFilters.location = '';
        discoveryFilters.origin = { latitude, longitude };
        discoveryFilters.originSource = 'gps';
        discoveryFilters.originLabel = 'Current location';
        if (discoveryFilters.radius === 'exact') discoveryFilters.radius = '10';
        syncDiscoveryControls();
        if (source === 'hero') navTo('browse');
        else {
            renderBrowseItems();
            renderAdvancedSearchResults();
        }
    }, error => {
        setNearMeLoading(source, false);
        if (error.code === error.PERMISSION_DENIED) {
            showToast("Location permission was denied. Allow it to use Near Me, or search a location manually.", "error");
        } else if (error.code === error.TIMEOUT) {
            showToast("Couldn't get your location in time. Try again or search manually.", "error");
        } else {
            showToast("Couldn't determine your location. You can still search manually.", "error");
        }
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
}

function resetDiscoveryFilters() {
    discoveryFilters = {
        keyword: '',
        category: 'all',
        location: '',
        mode: 'selected',
        radius: 'exact',
        type: 'all',
        status: 'Active',
        dateFrom: '',
        dateTo: '',
        sort: 'newest',
        origin: null,
        originSource: '',
        originLabel: ''
    };
    window.currentBrowseTypeFilter = 'all';
    setFilterReportType('all');
    syncDiscoveryControls();
    renderBrowseItems();
    renderAdvancedSearchResults();
}

function showToast(msg, type = "info") {
    const toast = document.createElement('div');
    let icon = 'fa-info-circle';
    let bg = 'bg-gray-900';

    if (type === 'success') { icon = 'fa-check-circle'; bg = 'bg-brand-700'; }
    if (type === 'error') { icon = 'fa-exclamation-circle'; bg = 'bg-red-600'; }

    toast.className = `${bg} text-white px-4 py-3 rounded-xl shadow-xl text-xs font-semibold flex items-center space-x-2 transition duration-300 transform translate-y-2`;
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHTML(msg)}</span>`;

    const container = document.getElementById('toast-container');
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function switchDashTab(tab) {
    document.querySelectorAll('.dashtab-content').forEach(el => el.classList.add('hidden'));
    const activePanel = document.getElementById(`dashtab-${tab}`);
    if (!activePanel) return;
    activePanel.classList.remove('hidden');

    ['my-reports', 'my-claims', 'messages'].forEach(t => {
        const btn = document.getElementById(`dashtab-btn-${t}`);
        btn.classList.toggle('is-active', t === tab);
    });
    const titles = { 'my-reports': 'My Reports', 'my-claims': 'Claims & Verification', messages: 'Messages' };
    document.getElementById('dashboard-panel-title').textContent = titles[tab] || 'Dashboard';
    document.getElementById('my-reports-filters').classList.toggle('hidden', tab !== 'my-reports');
}

function setMyReportsFilter(filter) {
    myReportsFilter = ['all', 'lost', 'found'].includes(filter) ? filter : 'all';
    ['all', 'lost', 'found'].forEach(type => {
        document.getElementById(`my-report-filter-${type}`).classList.toggle('is-active', type === myReportsFilter);
    });
    renderDashboard();
}

/* ==========================================================================
   EXPORTABLE SOURCE CODE TEMPLATES
   ========================================================================== */

const sourceCodeFiles = {
    app: `# ==============================================================================
# Trackfound - PYTHON FLASK BACKEND ROUTING ENGINE
# ==============================================================================

from flask import Flask, request, jsonify, render_template, session
from database import init_db, get_db_connection
import sqlite3
import datetime

app = Flask(__name__)
app.secret_key = 'Trackfound_secure_production_secret'

init_db()

@app.route('/api/reports', methods=['GET', 'POST'])
def handle_reports():
    conn = get_db_connection()
    if request.method == 'POST':
        data = request.json
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO reports (type, user_id, title, category, color, brand, incident_date, country, state, district, city, area, locality, place_name, latitude, longitude, description, private_detail, photo_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (data['type'], data['user_id'], data['title'], data['category'], data['color'], data.get('brand'), data['date'], data.get('country'), data.get('state'), data.get('district'), data.get('city'), data.get('area'), data.get('locality'), data.get('place_name'), data.get('latitude'), data.get('longitude'), data['description'], data['private_detail'], data.get('photo_url')))
        conn.commit()
        return jsonify({"status": "success", "message": "Report created"}), 201
    else:
        cursor = conn.cursor()
        reports = cursor.execute('SELECT * FROM reports WHERE status = "Active"').fetchall()
        return jsonify([dict(r) for r in reports])

if __name__ == '__main__':
    app.run(debug=True, port=5000)
`,
    db: `# ==============================================================================
# Trackfound - SQLITE DATABASE SCHEMA ARCHITECTURE
# ==============================================================================

import sqlite3

def get_db_connection():
    conn = sqlite3.connect('Trackfound.db')
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Reports Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            user_id INTEGER,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            color TEXT,
            brand TEXT,
            incident_date TEXT,
            country TEXT,
            state TEXT,
            district TEXT,
            city TEXT,
            area TEXT,
            locality TEXT,
            place_name TEXT,
            latitude REAL,
            longitude REAL,
            description TEXT,
            private_detail TEXT,
            photo_url TEXT,
            status TEXT DEFAULT 'Active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    columns = {row[1] for row in cursor.execute('PRAGMA table_info(reports)').fetchall()}
    for column, definition in (
        ('district', 'TEXT'),
        ('locality', 'TEXT'),
        ('place_name', 'TEXT'),
        ('latitude', 'REAL'),
        ('longitude', 'REAL'),
    ):
        if column not in columns:
            cursor.execute(f'ALTER TABLE reports ADD COLUMN {column} {definition}')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_reports_country_state_district_city ON reports(country, state, district, city)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_reports_area_locality_place ON reports(area, locality, place_name)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_reports_latitude_longitude ON reports(latitude, longitude)')
    conn.commit()
    conn.close()
`,
    req: `flask==3.0.0
gunicorn==21.2.0
werkzeug==3.0.1
pillow==10.1.0`,
    readme: `# Trackfound — Smart Lost & Found Community Platform

## Execution Instructions
1. Install Python 3.10+
2. Install dependencies: \`pip install -r requirements.txt\`
3. Run backend engine: \`python app.py\`
4. Open browser at \`http://127.0.0.1:5000\``,
    team: `# TEAM TASKS WORK DIVISION

## Developer 1: Backend & Scoring Architecture
- Setup SQLite database schemas
- Implement rule-based scoring matching engine

## Developer 2: Frontend UI & Security Guardrails
- Design responsive UI layout
- Implement document privacy redaction filters`,
    test: `# TESTING CHECKLIST

- [x] Initial DB starts completely empty
- [x] Privacy redaction masks sensitive document IDs
- [x] Rule algorithm scores matching criteria (0-100%)
- [x] Claim verification workflow functions smoothly`
};

function showCodeTab(tabKey) {
    document.getElementById('code-content-display').innerText = sourceCodeFiles[tabKey];
    ['app', 'db', 'req', 'readme', 'team', 'test'].forEach(k => {
        const btn = document.getElementById(`codetab-${k}`);
        if (k === tabKey) {
            btn.className = "px-3 py-1.5 bg-brand-700 text-white rounded-lg";
        } else {
            btn.className = "px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg";
        }
    });
}

function copyCodeContent() {
    const text = document.getElementById('code-content-display').innerText;
    const temp = document.createElement('textarea');
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
    showToast("Source code copied to clipboard!", "success");
}