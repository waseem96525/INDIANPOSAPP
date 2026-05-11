// Firebase-based POS System
let currentUser = null;

// User data storage (will be loaded per user)
let products = [];
let sales = [];
let customers = [];
let categories = ['Groceries', 'Beverages', 'Snacks', 'Household', 'Personal Care', 'Electronics', 'Other'];
let cart = [];
let heldBills = [];
let currentInvoiceId = 1;
let currentPage = 1;
let itemsPerPage = 6;

// Shop Details (per user)
let shopDetails = {};

// System Settings (per user)
let systemSettings = {
    currency: '₹',
    defaultGst: 18.00,
    itemsPerPage: 6,
    theme: 'light',
    autoBackup: true,
    printReceipt: false
};

// Wait for Firebase to initialize
let firebaseReady = false;
let developmentMode = false; // Set to true for local testing without Firebase, false for Firebase production

document.addEventListener('DOMContentLoaded', () => {
    // Check if we should run in development mode
    if (developmentMode) {
        console.log('Running in development mode (no Firebase)');
        firebaseReady = true;
        initializeApp();
        return;
    }

    // Wait for Firebase to be ready
    const checkFirebase = setInterval(() => {
        if (window.firebaseAuth && window.firebaseDatabase) {
            firebaseReady = true;
            clearInterval(checkFirebase);
            console.log('Firebase initialized successfully');
            initializeApp();
        }
    }, 100);

    // Timeout after 10 seconds if Firebase doesn't load
    setTimeout(() => {
        if (!firebaseReady) {
            console.warn('Firebase failed to initialize, falling back to development mode');
            developmentMode = true;
            firebaseReady = true;
            initializeApp();
        }
    }, 10000);
});

// Authentication State Observer
function initializeAuthStateObserver() {
    if (developmentMode) {
        // Check for stored user in development mode
        const storedUser = localStorage.getItem('devCurrentUser');
        if (storedUser) {
            currentUser = JSON.parse(storedUser);
            loadUserData(currentUser).then(() => {
                showApp();
            }).catch(() => {
                showAuthForms();
            });
        } else {
            showAuthForms();
        }
        return;
    }

    const { onAuthStateChanged } = window.firebaseFunctions;
    onAuthStateChanged(window.firebaseAuth, (user) => {
        if (user) {
            currentUser = user;
            loadUserData(user).then(() => {
                showApp();
            }).catch(() => {
                showAuthForms();
            });
        } else {
            currentUser = null;
            showAuthForms();
        }
    });
}

// Development mode mock functions
function devRegisterUser(userData) {
    return new Promise((resolve, reject) => {
        // Simulate API delay
        setTimeout(() => {
            // Check if user already exists
            const existingUsers = JSON.parse(localStorage.getItem('devUsers') || '[]');
            const existingUser = existingUsers.find(u => u.email === userData.email);

            if (existingUser) {
                reject(new Error('This email is already registered'));
                return;
            }

            // Create new user
            const newUser = {
                uid: 'dev_' + Date.now(),
                email: userData.email,
                displayName: `${userData.firstName} ${userData.lastName}`,
                firstName: userData.firstName,
                lastName: userData.lastName,
                username: userData.username,
                role: userData.role || 'user',
                createdAt: new Date().toISOString()
            };

            existingUsers.push(newUser);
            localStorage.setItem('devUsers', JSON.stringify(existingUsers));
            localStorage.setItem('devCurrentUser', JSON.stringify(newUser));

            resolve(newUser);
        }, 500);
    });
}

function devLoginUser(email, password) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            const users = JSON.parse(localStorage.getItem('devUsers') || '[]');
            const user = users.find(u => u.email === email);

            if (!user) {
                reject(new Error('No account found with this email'));
                return;
            }

            // In development mode, accept any password for the found user
            localStorage.setItem('devCurrentUser', JSON.stringify(user));
            resolve(user);
        }, 500);
    });
}

function devLogout() {
    localStorage.removeItem('devCurrentUser');
    currentUser = null;
    showAuthForms();
}

// Firebase User Registration
function registerUser(userData) {
    if (developmentMode) {
        return devRegisterUser(userData);
    }
    const { createUserWithEmailAndPassword } = window.firebaseFunctions;
    return createUserWithEmailAndPassword(window.firebaseAuth, userData.email, userData.password)
        .then((userCredential) => {
            const user = userCredential.user;

            // Save additional user data to database
            const { ref, set } = window.firebaseFunctions;
            const userRef = ref(window.firebaseDatabase, `users/${user.uid}`);
            return set(userRef, {
                firstName: userData.firstName,
                lastName: userData.lastName,
                username: userData.username,
                email: userData.email,
                role: userData.role || 'user',
                createdAt: new Date().toISOString(),
                lastLogin: new Date().toISOString()
            }).then(() => user);
        })
        .catch((error) => {
            console.error('Registration error:', error);
            // Provide user-friendly error messages
            let errorMessage = 'Registration failed';
            switch (error.code) {
                case 'auth/email-already-in-use':
                    errorMessage = 'This email is already registered';
                    break;
                case 'auth/invalid-email':
                    errorMessage = 'Invalid email address';
                    break;
                case 'auth/weak-password':
                    errorMessage = 'Password should be at least 6 characters';
                    break;
                case 'auth/network-request-failed':
                    errorMessage = 'Network error - check your connection';
                    break;
                default:
                    errorMessage = error.message;
            }
            throw new Error(errorMessage);
        });
}

// Firebase User Login
function loginUser(email, password) {
    if (developmentMode) {
        return devLoginUser(email, password);
    }

    const { signInWithEmailAndPassword } = window.firebaseFunctions;
    return signInWithEmailAndPassword(window.firebaseAuth, email, password)
        .catch((error) => {
            console.error('Login error:', error);
            // Provide user-friendly error messages
            let errorMessage = 'Login failed';
            switch (error.code) {
                case 'auth/user-not-found':
                    errorMessage = 'No account found with this email';
                    break;
                case 'auth/wrong-password':
                    errorMessage = 'Incorrect password';
                    break;
                case 'auth/invalid-email':
                    errorMessage = 'Invalid email address';
                    break;
                case 'auth/user-disabled':
                    errorMessage = 'This account has been disabled';
                    break;
                case 'auth/network-request-failed':
                    errorMessage = 'Network error - check your connection';
                    break;
                case 'auth/too-many-requests':
                    errorMessage = 'Too many failed attempts. Try again later';
                    break;
                default:
                    errorMessage = error.message;
            }
            throw new Error(errorMessage);
        });
}

// Load User Data (Firebase or localStorage)
function loadUserData(user) {
    if (developmentMode) {
        // Development mode: load from localStorage
        return new Promise((resolve) => {
            try {
                const userKey = `devUser_${user.uid || user.email}`;
                const userData = JSON.parse(localStorage.getItem(userKey) || '{}');

                // Load each data type
                products = userData.products || [];
                sales = userData.sales || [];
                customers = userData.customers || [];
                currentInvoiceId = sales.length > 0 ? Math.max(...sales.map(s => s.id)) + 1 : 1;
                categories = userData.categories || ['Groceries', 'Beverages', 'Snacks', 'Household', 'Personal Care', 'Electronics', 'Other'];
                heldBills = userData.heldBills || [];
                shopDetails = userData.shopDetails || {
                    name: `${user.displayName || user.email}'s POS Store`,
                    phone: '',
                    address: '',
                    email: user.email,
                    gst: '',
                    logo: ''
                };
                systemSettings = userData.systemSettings ? { ...systemSettings, ...userData.systemSettings } : systemSettings;

                resolve();
            } catch (error) {
                console.error('Failed to load from localStorage:', error);
                resolve();
            }
        });
    } else {
        // Firebase mode
        const { ref, get } = window.firebaseFunctions;

        const promises = [
            // Load products
            get(ref(window.firebaseDatabase, `users/${user.uid}/products`)).then(snapshot => {
                products = snapshot.exists() ? Object.values(snapshot.val()) : [];
            }),

            // Load sales
            get(ref(window.firebaseDatabase, `users/${user.uid}/sales`)).then(snapshot => {
                sales = snapshot.exists() ? Object.values(snapshot.val()) : [];
                currentInvoiceId = sales.length > 0 ? Math.max(...sales.map(s => s.id)) + 1 : 1;
            }),

            // Load customers
            get(ref(window.firebaseDatabase, `users/${user.uid}/customers`)).then(snapshot => {
                customers = snapshot.exists() ? Object.values(snapshot.val()) : [];
            }),

            // Load categories
            get(ref(window.firebaseDatabase, `users/${user.uid}/categories`)).then(snapshot => {
                categories = snapshot.exists() ? snapshot.val() : ['Groceries', 'Beverages', 'Snacks', 'Household', 'Personal Care', 'Electronics', 'Other'];
            }),

            // Load held bills
            get(ref(window.firebaseDatabase, `users/${user.uid}/heldBills`)).then(snapshot => {
                heldBills = snapshot.exists() ? Object.values(snapshot.val()) : [];
            }),

            // Load shop details
            get(ref(window.firebaseDatabase, `users/${user.uid}/shopDetails`)).then(snapshot => {
                shopDetails = snapshot.exists() ? snapshot.val() : {
                    name: `${user.displayName || user.email}'s POS Store`,
                    phone: '',
                    address: '',
                    email: user.email,
                    gst: '',
                    logo: ''
                };
            }),

            // Load system settings
            get(ref(window.firebaseDatabase, `users/${user.uid}/systemSettings`)).then(snapshot => {
                systemSettings = snapshot.exists() ? { ...systemSettings, ...snapshot.val() } : systemSettings;
            })
        ];

        return Promise.all(promises);
    }
}

// Generic function to load from user database
function loadFromUserDB(db, storeName) {
    return new Promise((resolve) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => {
            resolve(request.result);
        };
        request.onerror = () => {
            console.warn(`Failed to load ${storeName} from user database`);
            resolve(null);
        };
    });
}

// Save User Data (Firebase or localStorage)
function saveUserData(user, dataType, data) {
    if (!user) return Promise.resolve();

    if (developmentMode) {
        // Development mode: use localStorage
        return new Promise((resolve) => {
            try {
                const userKey = `devUser_${user.uid || user.email}`;
                const userData = JSON.parse(localStorage.getItem(userKey) || '{}');
                userData[dataType] = data;
                localStorage.setItem(userKey, JSON.stringify(userData));
                resolve();
            } catch (error) {
                console.error('Failed to save to localStorage:', error);
                resolve();
            }
        });
    } else {
        // Firebase mode
        const { ref, set } = window.firebaseFunctions;
        const userRef = ref(window.firebaseDatabase, `users/${user.uid}/${dataType}`);

        if (Array.isArray(data)) {
            // Convert array to object for Firebase
            const dataObject = {};
            data.forEach((item, index) => {
                dataObject[index] = item;
            });
            return set(userRef, dataObject);
        } else {
            return set(userRef, data);
        }
    }
}

// Reset User Database (for troubleshooting)
function resetUserDB() {
    return new Promise((resolve) => {
        if (!currentUser) {
            resolve();
            return;
        }

        const dbName = `POSUser_${currentUser.id}`;
        const deleteRequest = indexedDB.deleteDatabase(dbName);
        deleteRequest.onsuccess = () => {
            console.log('User database reset successfully');
            resolve();
        };
        deleteRequest.onerror = () => {
            console.warn('Failed to reset user database');
            resolve();
        };
    });
}

// Load data from IndexedDB
async function loadFromIndexedDB() {
    try {
        // Load products
        const productsStore = db.transaction('products').objectStore('products');
        const productsRequest = productsStore.getAll();
        productsRequest.onsuccess = () => {
            products = productsRequest.result.map(p => ({
                id: p.id,
                name: p.name || 'Unknown Product',
                barcode: p.barcode || '',
                hsn: p.hsn || '',
                category: p.category || 'Other',
                mrp: p.mrp || p.price || 0,
                costPrice: p.costPrice || 0,
                sellingPrice: p.sellingPrice || p.price || 0,
                discountPrice: p.discountPrice || 0,
                gstRate: p.gstRate || 0,
                stock: p.stock || 0,
                minStock: p.minStock || 0
            }));
        };

        // Load sales
        const salesStore = db.transaction('sales').objectStore('sales');
        const salesRequest = salesStore.getAll();
        salesRequest.onsuccess = () => {
            sales = salesRequest.result;
            currentInvoiceId = sales.length > 0 ? Math.max(...sales.map(s => s.id)) + 1 : 1;
        };

        // Load categories
        const categoriesStore = db.transaction('categories').objectStore('categories');
        const categoriesRequest = categoriesStore.getAll();
        categoriesRequest.onsuccess = () => {
            categories = categoriesRequest.result.length > 0 ? categoriesRequest.result.map(c => c.name) : categories;
        };

        // Load held bills
        const heldBillsStore = db.transaction('heldBills').objectStore('heldBills');
        const heldBillsRequest = heldBillsStore.getAll();
        heldBillsRequest.onsuccess = () => {
            heldBills = heldBillsRequest.result;
        };

        // Wait for all requests to complete
        await Promise.all([
            new Promise(resolve => productsRequest.onsuccess = resolve),
            new Promise(resolve => salesRequest.onsuccess = resolve),
            new Promise(resolve => categoriesRequest.onsuccess = resolve),
            new Promise(resolve => heldBillsRequest.onsuccess = resolve)
        ]);

        updateLastSaved();

    } catch (error) {
        console.error('Error loading from IndexedDB:', error);
        loadFromLocalStorage();
    }
}

// Fallback to localStorage
function loadFromLocalStorage() {
    document.getElementById('storage-type').textContent = 'localStorage';
    products = JSON.parse(localStorage.getItem('products')) || [];
    sales = JSON.parse(localStorage.getItem('sales')) || [];
    categories = JSON.parse(localStorage.getItem('categories')) || categories;
    heldBills = JSON.parse(localStorage.getItem('heldBills')) || [];
    currentInvoiceId = sales.length > 0 ? Math.max(...sales.map(s => s.id)) + 1 : 1;

    // Migrate old product data to new format
    products = products.map(p => ({
        id: p.id || Date.now() + Math.random(),
        name: p.name || 'Unknown Product',
        barcode: p.barcode || '',
        hsn: p.hsn || '',
        category: p.category || 'Other',
        mrp: p.mrp || p.price || 0,
        costPrice: p.costPrice || 0,
        sellingPrice: p.sellingPrice || p.price || 0,
        discountPrice: p.discountPrice || 0,
        gstRate: p.gstRate || 0,
        stock: p.stock || 0,
        minStock: p.minStock || 0
    }));

    // Save to IndexedDB if available
    if (db) {
        saveAllToIndexedDB();
    }
}

// Save data to IndexedDB
function saveToIndexedDB(storeName, data) {
    return new Promise((resolve) => {
        if (!db) {
            // Fallback to localStorage
            try {
                if (storeName === 'products') localStorage.setItem('products', JSON.stringify(data));
                if (storeName === 'sales') localStorage.setItem('sales', JSON.stringify(data));
                if (storeName === 'categories') localStorage.setItem('categories', JSON.stringify(data.map(c => ({ name: c }))));
                if (storeName === 'heldBills') localStorage.setItem('heldBills', JSON.stringify(data));
            } catch (error) {
                console.error('localStorage fallback failed:', error);
            }
            resolve();
            return;
        }

        try {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);

            // Clear existing data
            const clearRequest = store.clear();
            clearRequest.onsuccess = () => {
                for (const item of data) {
                    store.add(item);
                }
            };

            transaction.oncomplete = () => {
                updateLastSaved();
                resolve();
            };

            transaction.onerror = (event) => {
                console.warn('IndexedDB transaction failed, falling back to localStorage:', event.target.error);
                // Fallback to localStorage
                try {
                    if (storeName === 'products') localStorage.setItem('products', JSON.stringify(data));
                    if (storeName === 'sales') localStorage.setItem('sales', JSON.stringify(data));
                    if (storeName === 'categories') localStorage.setItem('categories', JSON.stringify(data.map(c => ({ name: c }))));
                    if (storeName === 'heldBills') localStorage.setItem('heldBills', JSON.stringify(data));
                    updateLastSaved();
                } catch (error) {
                    console.error('Both IndexedDB and localStorage failed:', error);
                }
                resolve(); // Always resolve to prevent unhandled promise rejections
            };
        } catch (error) {
            console.error('Error saving to IndexedDB:', error);
            // Fallback to localStorage
            try {
                if (storeName === 'products') localStorage.setItem('products', JSON.stringify(data));
                if (storeName === 'sales') localStorage.setItem('sales', JSON.stringify(data));
                if (storeName === 'categories') localStorage.setItem('categories', JSON.stringify(data.map(c => ({ name: c }))));
                if (storeName === 'heldBills') localStorage.setItem('heldBills', JSON.stringify(data));
                updateLastSaved();
            } catch (localStorageError) {
                console.error('Both IndexedDB and localStorage failed:', localStorageError);
            }
            resolve();
        }
    });
}

// Save all data to Firebase
function saveAllToUserDB() {
    if (!currentUser) return Promise.resolve();

    return Promise.all([
        saveUserData(currentUser, 'products', products),
        saveUserData(currentUser, 'sales', sales),
        saveUserData(currentUser, 'customers', customers),
        saveUserData(currentUser, 'categories', categories),
        saveUserData(currentUser, 'heldBills', heldBills),
        saveUserData(currentUser, 'shopDetails', shopDetails),
        saveUserData(currentUser, 'systemSettings', systemSettings)
    ]).then(() => {
        updateLastSaved();
    }).catch((error) => {
        console.error('Failed to save all data:', error);
    });
}

// DOM Elements
const authContainer = document.getElementById('auth-container');
const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
const app = document.getElementById('app');
const logoutBtn = document.createElement('button'); // Will be added to header
const sections = document.querySelectorAll('.section');
const navButtons = document.querySelectorAll('nav button');
const productForm = document.getElementById('product-form');
const inventoryTable = document.getElementById('inventory-body');
const cartTable = document.getElementById('cart-body');
const salesTable = document.getElementById('sales-body');
const searchInput = document.getElementById('search-product');
const addToCartBtn = document.getElementById('add-to-cart-btn');
const generateInvoiceBtn = document.getElementById('generate-invoice');
const subtotalEl = document.getElementById('subtotal');
const totalGstEl = document.getElementById('total-gst');
const totalAmountEl = document.getElementById('total-amount');
const totalSalesEl = document.getElementById('total-sales');
const totalGstCollectedEl = document.getElementById('total-gst-collected');
const filterCategory = document.getElementById('filter-category');
const filterName = document.getElementById('filter-name');
const sortBy = document.getElementById('sort-by');
const newCategoryInput = document.getElementById('new-category');
const addCategoryBtn = document.getElementById('add-category-btn');
const discountPercent = document.getElementById('discount-percent');
const discountFlat = document.getElementById('discount-flat');
const paymentMethod = document.getElementById('payment-method');
const referenceNo = document.getElementById('reference-no');

const balanceAmount = document.getElementById('balance-amount');
const cartCount = document.getElementById('cart-count');
const totalItems = document.getElementById('total-items');
const roundOff = document.getElementById('round-off');
const quickProductsList = document.getElementById('quick-products-list');
const productSuggestions = document.getElementById('product-suggestions');
const splitPaymentSection = document.getElementById('split-payment-section');
const holdBillBtn = document.getElementById('hold-bill-btn');
const retrieveBillBtn = document.getElementById('retrieve-bill-btn');
const clearCartBtn = document.getElementById('clear-cart-btn');
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');
const selectAllCheckbox = document.getElementById('select-all');
const bulkDeleteBtn = document.getElementById('bulk-delete');
const exportCsvBtn = document.getElementById('export-csv');
const reprintBillBtn = document.getElementById('reprint-bill-btn');





// Navigation
navButtons.forEach(button => {
    button.addEventListener('click', () => {
        const sectionId = button.id.replace('nav-', '');
        if (sectionId === 'settings') {
            showSettingsModal();
        } else {
            showSection(sectionId);
            if (sectionId === 'dashboard') {
                updateDashboard();
            } else if (sectionId === 'reports') {
                displayReports();
            }
        }
    });
});

function showSection(sectionId) {
    sections.forEach(section => {
        section.classList.remove('active');
    });
    document.getElementById(sectionId).classList.add('active');
    if (sectionId === 'billing') {
        updateQuickProducts();
    }
}

// Global functions for onclick
function scanBarcode() {
    const barcode = prompt('Enter barcode:');
    if (barcode) {
        const product = products.find(p => p.barcode === barcode);
        if (product) {
            addToCart(product);
        } else {
            alert('Product not found');
        }
    }
}

function showQuickKeys() {
    alert('Quick keys: Press number keys to add quantities, F1 for discount, etc.');
}

// Category management
function updateCategorySelect() {
    const select = document.getElementById('product-category');
    select.innerHTML = '<option value="">Select Category</option>';
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        select.appendChild(option);
    });
}

function updateFilterCategory() {
    const select = document.getElementById('filter-category');
    select.innerHTML = '<option value="">All Categories</option>';
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        select.appendChild(option);
    });
}

// Filters
filterCategory.addEventListener('change', () => { currentPage = 1; displayProducts(filterCategory.value, filterName.value, sortBy.value); });
filterName.addEventListener('input', () => { currentPage = 1; displayProducts(filterCategory.value, filterName.value, sortBy.value); });
sortBy.addEventListener('change', () => { currentPage = 1; displayProducts(filterCategory.value, filterName.value, sortBy.value); });

// Add Category
addCategoryBtn.addEventListener('click', () => {
    const newCat = newCategoryInput.value.trim();
    if (newCat && !categories.includes(newCat)) {
        categories.push(newCat);
        saveUserData(currentUser, 'categories', categories).catch(error => console.error('Failed to save categories:', error));
        updateCategorySelect();
        updateFilterCategory();
        newCategoryInput.value = '';
    } else if (categories.includes(newCat)) {
        alert('Category already exists');
    } else {
        alert('Enter a category name');
    }
});

// Pagination
prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
    displayProducts(filterCategory.value, filterName.value, sortBy.value, currentPage);
    }
});
nextPageBtn.addEventListener('click', () => {
    currentPage++;
    displayProducts(filterCategory.value, filterName.value, sortBy.value);
});

// Bulk Actions
selectAllCheckbox.addEventListener('change', () => {
    const checkboxes = document.querySelectorAll('.product-checkbox');
    checkboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
});

bulkDeleteBtn.addEventListener('click', () => {
    const checkedBoxes = document.querySelectorAll('.product-checkbox:checked');
    if (checkedBoxes.length === 0) {
        alert('No products selected');
        return;
    }
    if (confirm(`Are you sure you want to delete ${checkedBoxes.length} product(s)?`)) {
        const idsToDelete = Array.from(checkedBoxes).map(cb => parseInt(cb.dataset.id));
        products = products.filter(p => !idsToDelete.includes(p.id));
        saveUserData(currentUser, 'products', products).catch(error => console.error('Failed to save products:', error));
        displayProducts(filterCategory.value, filterName.value, sortBy.value, currentPage);
    }
});

// Inventory Management
function displayProducts(filterCategory = '', filterName = '', sortBy = 'name', page = 1) {
    const inventoryGrid = document.getElementById('inventory-grid');
    inventoryGrid.innerHTML = '';
    let filteredProducts = products.filter(product =>
        (filterCategory === '' || product.category === filterCategory) &&
        (filterName === '' || product.name.toLowerCase().includes(filterName.toLowerCase()))
    );

    filteredProducts.sort((a, b) => {
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        if (sortBy === 'sellingPrice') return (a.sellingPrice || a.price || 0) - (b.sellingPrice || b.price || 0);
        if (sortBy === 'stock') return a.stock - b.stock;
        if (sortBy === 'minStock') return (a.minStock || 0) - (b.minStock || 0);
        return 0;
    });

    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
    currentPage = Math.min(page, totalPages) || 1;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

    paginatedProducts.forEach((product) => {
        const originalIndex = products.indexOf(product);
        const card = document.createElement('div');
        const stock = product.stock || 0;
        const minStock = product.minStock || 0;
        const isLowStock = stock <= minStock;
        card.className = `product-card ${isLowStock ? 'low-stock' : ''}`;
        card.innerHTML = `
            <input type="checkbox" class="product-checkbox" data-id="${product.id}">
            <img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgZmlsbD0iI2NjYyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmaWxsPSJ3aGl0ZSIgZHk9Ii4zNWVtIiBmb250LXNpemU9IjE0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5Qcm9kdWN0PC90ZXh0Pjwvc3ZnPg==" alt="Product Image">
            <h3>${product.name || 'Unknown'}</h3>
            <p><strong>Barcode:</strong> ${product.barcode || 'N/A'}</p>
            <p><strong>Category:</strong> ${product.category || 'N/A'}</p>
            <p><strong>MRP:</strong> ${systemSettings.currency}${(product.mrp || 0).toFixed(2)}</p>
            <p><strong>Cost Price:</strong> ${systemSettings.currency}${(product.costPrice || 0).toFixed(2)}</p>
            <p><strong>Selling Price:</strong> ${systemSettings.currency}${(product.sellingPrice || product.price || 0).toFixed(2)}</p>
            <p><strong>Discount Price:</strong> ${systemSettings.currency}${(product.discountPrice || 0).toFixed(2)}</p>
            <p><strong>GST:</strong> ${product.gstRate || 0}%</p>
            <p><strong>Stock:</strong> ${stock}${minStock > 0 ? ` (Min: ${minStock})` : ''}</p>
            <div class="card-actions">
                <button class="edit" onclick="editProduct(${originalIndex})">Edit</button>
                <button onclick="deleteProduct(${originalIndex})">Delete</button>
            </div>
        `;
        inventoryGrid.appendChild(card);
    });

    // Update pagination
    pageInfo.textContent = `Page ${currentPage} of ${totalPages || 1}`;
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages || totalPages === 0;
    selectAllCheckbox.checked = false;
}

productForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('product-name').value;
    const barcode = document.getElementById('barcode').value;
    const hsn = document.getElementById('hsn-code').value;
    const category = document.getElementById('product-category').value;
    const mrp = parseFloat(document.getElementById('mrp').value) || 0;
    const costPrice = parseFloat(document.getElementById('cost-price').value) || 0;
    const sellingPrice = parseFloat(document.getElementById('selling-price').value);
    const discountPrice = parseFloat(document.getElementById('discount-price').value) || 0;
    const gstRate = parseFloat(document.getElementById('gst-rate').value);
    const stock = parseInt(document.getElementById('stock').value);
    const minStock = parseInt(document.getElementById('min-stock').value) || 0;

    const newProduct = { id: Date.now(), name, barcode, hsn, category, mrp, costPrice, sellingPrice, discountPrice, gstRate, stock, minStock };
    products.push(newProduct);
    saveUserData(currentUser, 'products', products).catch(error => console.error('Failed to save products:', error));
    displayProducts(filterCategory.value, filterName.value, sortBy.value, currentPage);
    updateDashboard(); // Refresh dashboard with new product count
    productForm.reset();
});

function editProduct(index) {
    if (!products[index]) {
        alert('Product not found');
        return;
    }
    const product = products[index];
    document.getElementById('product-name').value = product.name || '';
    document.getElementById('barcode').value = product.barcode || '';
    document.getElementById('hsn-code').value = product.hsn || '';
    document.getElementById('product-category').value = product.category || '';
    document.getElementById('mrp').value = product.mrp || '';
    document.getElementById('cost-price').value = product.costPrice || '';
    document.getElementById('selling-price').value = product.sellingPrice || product.price || '';
    document.getElementById('discount-price').value = product.discountPrice || '';
    document.getElementById('gst-rate').value = product.gstRate || '';
    document.getElementById('stock').value = product.stock || '';
    document.getElementById('min-stock').value = product.minStock || '';

    // Remove the old product and add new on submit
    products.splice(index, 1);
}

function deleteProduct(index) {
    if (confirm('Are you sure you want to delete this product?')) {
        products.splice(index, 1);
        saveUserData(currentUser, 'products', products).catch(error => console.error('Failed to save products:', error));
        displayProducts(filterCategory.value, filterName.value, sortBy.value, currentPage);
    }
}

// Billing
function displayCart() {
    const cartItems = document.getElementById('cart-items');
    cartItems.innerHTML = '';
    let subtotal = 0;
    let totalGst = 0;
    let itemCount = 0;

    if (cart.length === 0) {
        cartItems.innerHTML = '<p class="empty-cart">Cart is empty</p>';
    }

    cart.forEach((item, index) => {
        const price = item.product.sellingPrice || item.product.price || 0;
        const gstAmount = (price * item.qty * item.product.gstRate) / 100;
        const total = (price * item.qty) + gstAmount;
        subtotal += price * item.qty;
        totalGst += gstAmount;
        itemCount += item.qty;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'cart-item';
        itemDiv.innerHTML = `
            <img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiBmaWxsPSIjY2NjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZpbGw9IndoaXRlIiBkeT0iLjM1ZW0iIGZvbnQtc2l6ZT0iMTAiIHRleHQtYW5jaG9yPSJtaWRkbGUiPlByb2Q8L3RleHQ+PC9zdmc+" alt="Product">
            <div class="cart-item-details">
                <h4>${item.product.name}</h4>
                <p>Rate: ₹${price.toFixed(2)} | Qty: ${item.qty}</p>
                <p>GST: ₹${gstAmount.toFixed(2)}</p>
            </div>
            <span class="cart-item-total">₹${total.toFixed(2)}</span>
            <div class="cart-item-controls">
                <input type="number" value="${item.qty}" min="1" onchange="updateQty(${index}, this.value)">
                <button onclick="removeFromCart(${index})"><i class="fas fa-trash"></i></button>
            </div>
        `;
        cartItems.appendChild(itemDiv);
    });

    const discountPct = parseFloat(discountPercent.value) || 0;
    const discountFlatAmt = parseFloat(discountFlat.value) || 0;
    const discountAmount = (subtotal * discountPct) / 100 + discountFlatAmt;
    const finalSubtotal = subtotal - discountAmount;
    const totalBeforeRound = finalSubtotal + totalGst;
    const roundedTotal = Math.round(totalBeforeRound);
    const roundOffAmt = roundedTotal - totalBeforeRound;

    cartCount.textContent = itemCount;
    totalItems.textContent = itemCount;
    subtotalEl.textContent = systemSettings.currency + finalSubtotal.toFixed(2);
    totalGstEl.textContent = systemSettings.currency + totalGst.toFixed(2);
    roundOff.textContent = (roundOffAmt >= 0 ? '+' : '') + systemSettings.currency + roundOffAmt.toFixed(2);
    totalAmountEl.textContent = systemSettings.currency + roundedTotal.toFixed(2);
}



addToCartBtn.addEventListener('click', () => {
    const searchTerm = searchInput.value.toLowerCase();
    const product = products.find(p => p.name.toLowerCase().includes(searchTerm) || (p.barcode && p.barcode.includes(searchTerm)));
    if (product) {
        addToCart(product);
        searchInput.value = '';
        productSuggestions.style.display = 'none';
    } else {
        alert('Product not found');
    }
});

function addToCart(product) {
    const existingItem = cart.find(item => item.product.name === product.name);
    if (existingItem) {
        existingItem.qty += 1;
    } else {
        cart.push({ product, qty: 1 });
    }
    displayCart();
}

searchInput.addEventListener('input', () => {
    const searchTerm = searchInput.value.toLowerCase();
    if (searchTerm.length < 2) {
        productSuggestions.style.display = 'none';
        return;
    }
    const matches = products.filter(p => 
        p.name.toLowerCase().includes(searchTerm) || 
        (p.barcode && p.barcode.includes(searchTerm))
    ).slice(0, 5);
    
    if (matches.length > 0) {
        productSuggestions.innerHTML = matches.map(p => `
            <div class="suggestion-item" onclick="addToCart(products.find(pr => pr.name === '${p.name}')); searchInput.value='${p.name}'; productSuggestions.style.display='none';">
                <h5>${p.name}</h5>
                <p>₹${(p.sellingPrice || p.price || 0).toFixed(2)} | Stock: ${p.stock}</p>
            </div>
        `).join('');
        productSuggestions.style.display = 'block';
    } else {
        productSuggestions.style.display = 'none';
    }
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.product-section')) {
        productSuggestions.style.display = 'none';
    }
});

discountPercent.addEventListener('input', displayCart);
discountFlat.addEventListener('input', displayCart);

paymentMethod.addEventListener('change', () => {
    splitPaymentSection.style.display = paymentMethod.value === 'Split' ? 'block' : 'none';
});

function updateSplitPayment() {
    const cashAmountEl = document.getElementById('cash-amount');
    const onlineAmountEl = document.getElementById('online-amount');
    if (!cashAmountEl || !onlineAmountEl) return;
    const cash = parseFloat(cashAmountEl.value) || 0;
    const online = parseFloat(onlineAmountEl.value) || 0;
    const total = parseFloat(totalAmountEl.textContent.replace(systemSettings.currency, '')) || 0;
    const totalPaidAmount = cash + online;
    const balance = total - totalPaidAmount;
    const totalPaidEl = document.getElementById('total-paid');
    if (totalPaidEl) totalPaidEl.textContent = systemSettings.currency + totalPaidAmount.toFixed(2);
    balanceAmount.textContent = (balance >= 0 ? systemSettings.currency : '-' + systemSettings.currency) + Math.abs(balance).toFixed(2);
}



holdBillBtn.addEventListener('click', () => {
    if (cart.length === 0) {
        alert('Cart is empty');
        return;
    }
    const billName = prompt('Enter a name for this bill:');
    if (billName) {
        heldBills.push({
            name: billName,
            cart: [...cart],
            customer: document.getElementById('customer-name').value,
            phone: document.getElementById('customer-phone').value,
            timestamp: new Date().toLocaleString()
        });
        saveUserData(currentUser, 'heldBills', heldBills).catch(error => console.error('Failed to save held bills:', error));
        cart = [];
        displayCart();
        alert('Bill held successfully');
    }
});

retrieveBillBtn.addEventListener('click', () => {
    if (heldBills.length === 0) {
        alert('No held bills');
        return;
    }
    const billList = heldBills.map((b, i) => `${i + 1}. ${b.name} (${b.timestamp})`).join('\n');
    const choice = prompt(`Select bill to retrieve:\n${billList}`);
    if (choice) {
        const index = parseInt(choice) - 1;
        if (index >= 0 && index < heldBills.length) {
            cart = [...heldBills[index].cart];
            document.getElementById('customer-name').value = heldBills[index].customer || '';
            document.getElementById('customer-phone').value = heldBills[index].phone || '';
            heldBills.splice(index, 1);
            saveUserData(currentUser, 'heldBills', heldBills).catch(error => console.error('Failed to save held bills:', error));
            displayCart();
        }
    }
});

clearCartBtn.addEventListener('click', () => {
    if (cart.length === 0) return;
    if (confirm('Clear all items from cart?')) {
        cart = [];
        displayCart();
        discountPercent.value = '';
        discountFlat.value = '';
    }
});

if (reprintBillBtn) reprintBillBtn.addEventListener('click', () => {
    if (sales.length === 0) {
        alert('No bills available to reprint');
        return;
    }
    const billList = sales.slice(-20).map((s, i) => `${sales.length - 20 + i + 1}. Inv #${s.id} - ${s.customer} - ${systemSettings.currency}${s.total.toFixed(2)} (${s.date})`).join('\n');
    const choice = prompt(`Select bill to reprint (last 20):\n${billList}`);
    if (choice) {
        const index = parseInt(choice) - 1;
        const billIndex = sales.length - 20 + index;
        if (billIndex >= 0 && billIndex < sales.length) {
            reprintBill(sales[billIndex]);
        } else {
            alert('Invalid selection');
        }
    }
});

function updateQty(index, qty) {
    cart[index].qty = parseInt(qty);
    displayCart();
}

function removeFromCart(index) {
    cart.splice(index, 1);
    displayCart();
}

generateInvoiceBtn.addEventListener('click', () => {
    if (cart.length === 0) {
        alert('Cart is empty');
        return;
    }

    const customerName = document.getElementById('customer-name').value || 'Walk-in';
    const customerPhone = document.getElementById('customer-phone').value || '';
    const payment = paymentMethod.value;
    const refNo = referenceNo.value;
    const total = parseFloat(totalAmountEl.textContent.replace(systemSettings.currency, '')) || 0;

    const subtotal = parseFloat(subtotalEl.textContent.replace(systemSettings.currency, ''));
    const gst = parseFloat(totalGstEl.textContent.replace(systemSettings.currency, ''));
    const discountPct = parseFloat(discountPercent.value) || 0;
    const discountFlatAmt = parseFloat(discountFlat.value) || 0;

    const invoice = {
        id: currentInvoiceId++,
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
        customer: customerName,
        phone: customerPhone,
        payment,
        reference: refNo,
        items: [...cart],
        subtotal,
        discountPercent: discountPct,
        discountFlat: discountFlatAmt,
        gst,
        total
    };

    sales.push(invoice);
    saveUserData(currentUser, 'sales', sales).catch(error => console.error('Failed to save sales:', error));

    // Update inventory
    cart.forEach(item => {
        const product = products.find(p => p.name === item.product.name);
        if (product) {
            product.stock -= item.qty;
        }
    });
    saveUserData(currentUser, 'products', products).catch(error => console.error('Failed to save products:', error));

    // Populate and print invoice
    // Shop details
    document.getElementById('invoice-shop-name').textContent = shopDetails.name || 'Shop Name';
    document.getElementById('invoice-shop-address').textContent = shopDetails.address || '';

    // Invoice details
    document.getElementById('invoice-id').textContent = invoice.id;
    document.getElementById('invoice-date').textContent = invoice.date + ' ' + invoice.time;
    document.getElementById('invoice-customer').textContent = invoice.customer;
    document.getElementById('invoice-payment').textContent = invoice.payment + (invoice.reference ? ` (${invoice.reference})` : '');
    document.getElementById('invoice-total').textContent = systemSettings.currency + invoice.total.toFixed(2);

    const invoiceItems = document.getElementById('invoice-items');
    invoiceItems.innerHTML = '';
    invoice.items.forEach(item => {
        const price = item.product.sellingPrice || item.product.price || 0;
        const gstAmount = (price * item.qty * item.product.gstRate) / 100;
        const itemTotal = (price * item.qty) + gstAmount;
        const itemDiv = document.createElement('p');
        itemDiv.textContent = `${item.product.name} x${item.qty} - ₹${itemTotal.toFixed(2)}`;
        itemDiv.style.margin = '2px 0';
        itemDiv.style.fontWeight = 'bolder';
        invoiceItems.appendChild(itemDiv);
    });

    const invoiceTemplate = document.getElementById('invoice-template');
    invoiceTemplate.style.display = 'block';
    window.print();
    invoiceTemplate.style.display = 'none';

    cart = [];
    displayCart();
    displayProducts(filterCategory.value, filterName.value, sortBy.value, currentPage);
    displayReports();
    updateDashboard(); // Refresh dashboard with new sales data
    document.getElementById('customer-name').value = '';
    document.getElementById('customer-phone').value = '';
    discountPercent.value = '';
    discountFlat.value = '';
});

function reprintBill(invoice) {
    // Populate invoice template with the selected bill data
    // Shop details
    document.getElementById('invoice-shop-name').textContent = shopDetails.name || 'Shop Name';
    document.getElementById('invoice-shop-address').textContent = shopDetails.address || '';

    // Invoice details
    document.getElementById('invoice-id').textContent = invoice.id;
    document.getElementById('invoice-date').textContent = (invoice.date || '') + ' ' + (invoice.time || '');
    document.getElementById('invoice-customer').textContent = invoice.customer;
    document.getElementById('invoice-payment').textContent = invoice.payment + (invoice.reference ? ` (${invoice.reference})` : '');
    document.getElementById('invoice-total').textContent = systemSettings.currency + invoice.total.toFixed(2);

    const invoiceItems = document.getElementById('invoice-items');
    invoiceItems.innerHTML = '';
    invoice.items.forEach(item => {
        const price = item.product.sellingPrice || item.product.price || 0;
        const gstAmount = (price * item.qty * item.product.gstRate) / 100;
        const itemTotal = (price * item.qty) + gstAmount;
        const itemDiv = document.createElement('p');
        itemDiv.textContent = `${item.product.name} x${item.qty} - ₹${itemTotal.toFixed(2)}`;
        itemDiv.style.margin = '2px 0';
        itemDiv.style.fontWeight = 'bolder';
        invoiceItems.appendChild(itemDiv);
    });

    const invoiceTemplate = document.getElementById('invoice-template');
    invoiceTemplate.style.display = 'block';
    window.print();
    invoiceTemplate.style.display = 'none';
}

function reprintBillById(id) {
    const invoice = sales.find(s => s.id === id);
    if (invoice) {
        reprintBill(invoice);
    } else {
        alert('Bill not found');
    }
}

// Reports
let salesChart = null;
let categoryChart = null;
let paymentChart = null;
let paymentMethodChart = null;
let dailyTrendChart = null;
let weeklyChart = null;

// Current date filter
let currentStartDate = null;
let currentEndDate = null;

function getFilteredSales() {
    if (!currentStartDate && !currentEndDate) return sales;

    return sales.filter(sale => {
        const saleDate = new Date(sale.date);
        const start = currentStartDate ? new Date(currentStartDate) : null;
        const end = currentEndDate ? new Date(currentEndDate) : null;

        if (start && end) {
            return saleDate >= start && saleDate <= end;
        } else if (start) {
            return saleDate >= start;
        } else if (end) {
            return saleDate <= end;
        }
        return true;
    });
}

function displayReports() {
    const filteredSales = getFilteredSales();

    // Update overview tab
    updateOverviewTab(filteredSales);

    // Update category tab
    updateCategoryTab(filteredSales);

    // Update payment tab
    updatePaymentTab(filteredSales);

    // Update trends tab
    updateTrendsTab(filteredSales);
}

function updateOverviewTab(filteredSales) {
    const salesTable = document.getElementById('sales-body');
    salesTable.innerHTML = '';

    let totalSales = 0;
    let totalGst = 0;
    const labels = [];
    const data = [];
    const paymentData = { Cash: 0, Card: 0, UPI: 0, Split: 0 };

    filteredSales.forEach(sale => {
        totalSales += sale.total;
        totalGst += sale.gst;

        labels.push(`Inv ${sale.id}`);
        data.push(sale.total);

        // Count payment methods
        const payment = sale.payment || 'Cash';
        paymentData[payment] = (paymentData[payment] || 0) + 1;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${sale.date}</td>
            <td>#${sale.id}</td>
            <td>${sale.customer}</td>
            <td>${sale.items ? sale.items.length : 0}</td>
            <td>${systemSettings.currency}${sale.total.toFixed(2)}</td>
            <td>${sale.payment || 'Cash'}</td>
        `;
        salesTable.appendChild(row);
    });

    const avgOrder = filteredSales.length > 0 ? totalSales / filteredSales.length : 0;

    document.getElementById('total-sales').textContent = totalSales.toFixed(2);
    document.getElementById('total-orders').textContent = filteredSales.length;
    document.getElementById('total-gst-collected').textContent = totalGst.toFixed(2);
    document.getElementById('avg-order').textContent = avgOrder.toFixed(2);

    // Update percentage changes (simplified)
    const salesChange = filteredSales.length > 0 ? '+12%' : '+0%';
    const ordersChange = filteredSales.length > 0 ? '+8%' : '+0%';
    const gstChange = totalGst > 0 ? '+15%' : '+0%';
    const avgChange = avgOrder > 0 ? '+5%' : '+0%';

    document.getElementById('sales-change').textContent = salesChange;
    document.getElementById('orders-change').textContent = ordersChange;
    document.getElementById('gst-change').textContent = gstChange;
    document.getElementById('avg-change').textContent = avgChange;

    // Sales chart
    const ctx = document.getElementById('sales-chart').getContext('2d');
    if (salesChart) {
        salesChart.destroy();
    }
    salesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.slice(-10),
            datasets: [{
                label: `Sales Amount (${systemSettings.currency})`,
                data: data.slice(-10),
                backgroundColor: 'rgba(40, 167, 69, 0.2)',
                borderColor: 'rgba(40, 167, 69, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });

    // Payment distribution chart
    const paymentCtx = document.getElementById('payment-chart').getContext('2d');
    if (paymentChart) {
        paymentChart.destroy();
    }
    paymentChart = new Chart(paymentCtx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(paymentData),
            datasets: [{
                data: Object.values(paymentData),
                backgroundColor: [
                    'rgba(40, 167, 69, 0.8)',
                    'rgba(0, 123, 255, 0.8)',
                    'rgba(255, 193, 7, 0.8)',
                    'rgba(220, 53, 69, 0.8)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

function updateCategoryTab(filteredSales) {
    const categoryData = {};
    const categoryTable = document.getElementById('category-body');
    categoryTable.innerHTML = '';

    // Aggregate sales by category
    filteredSales.forEach(sale => {
        if (sale.items) {
            sale.items.forEach(item => {
                const product = products.find(p => p.name === item.product.name);
                const category = product ? product.category : 'Other';

                if (!categoryData[category]) {
                    categoryData[category] = {
                        sales: 0,
                        items: 0,
                        revenue: 0
                    };
                }

                categoryData[category].sales += item.product.sellingPrice * item.qty;
                categoryData[category].items += item.qty;
                categoryData[category].revenue += item.product.sellingPrice * item.qty;
            });
        }
    });

    const totalRevenue = Object.values(categoryData).reduce((sum, cat) => sum + cat.revenue, 0);

    // Create table rows and chart data
    const labels = [];
    const data = [];

    Object.entries(categoryData).forEach(([category, stats]) => {
        const percentage = totalRevenue > 0 ? ((stats.revenue / totalRevenue) * 100).toFixed(1) : 0;
        const avgPrice = stats.items > 0 ? (stats.revenue / stats.items).toFixed(2) : 0;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${category}</td>
            <td>${systemSettings.currency}${stats.revenue.toFixed(2)}</td>
            <td>${stats.items}</td>
            <td>${systemSettings.currency}${avgPrice}</td>
            <td>${percentage}%</td>
        `;
        categoryTable.appendChild(row);

        labels.push(category);
        data.push(stats.revenue);
    });

    // Category chart
    const ctx = document.getElementById('category-chart').getContext('2d');
    if (categoryChart) {
        categoryChart.destroy();
    }
    categoryChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    'rgba(255, 99, 132, 0.8)',
                    'rgba(54, 162, 235, 0.8)',
                    'rgba(255, 205, 86, 0.8)',
                    'rgba(75, 192, 192, 0.8)',
                    'rgba(153, 102, 255, 0.8)',
                    'rgba(255, 159, 64, 0.8)',
                    'rgba(201, 203, 207, 0.8)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

function updatePaymentTab(filteredSales) {
    const paymentStats = {
        Cash: { total: 0, count: 0 },
        Card: { total: 0, count: 0 },
        UPI: { total: 0, count: 0 },
        Split: { total: 0, count: 0 }
    };

    filteredSales.forEach(sale => {
        const payment = sale.payment || 'Cash';
        paymentStats[payment].total += sale.total;
        paymentStats[payment].count += 1;
    });

    // Update payment metrics
    Object.keys(paymentStats).forEach(method => {
        const stats = paymentStats[method];
        document.getElementById(`${method.toLowerCase()}-total`).textContent = stats.total.toFixed(2);
        document.getElementById(`${method.toLowerCase()}-count`).textContent = stats.count;
    });

    // Payment method chart
    const ctx = document.getElementById('payment-method-chart').getContext('2d');
    if (paymentMethodChart) {
        paymentMethodChart.destroy();
    }
    paymentMethodChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(paymentStats),
            datasets: [{
                label: `Payment Amount (${systemSettings.currency})`,
                data: Object.values(paymentStats).map(s => s.total),
                backgroundColor: 'rgba(0, 123, 255, 0.2)',
                borderColor: 'rgba(0, 123, 255, 1)',
                borderWidth: 1
            }, {
                label: 'Transaction Count',
                data: Object.values(paymentStats).map(s => s.count),
                backgroundColor: 'rgba(40, 167, 69, 0.2)',
                borderColor: 'rgba(40, 167, 69, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function updateTrendsTab(filteredSales) {
    // Daily sales trend
    const dailyData = {};
    filteredSales.forEach(sale => {
        const date = sale.date;
        dailyData[date] = (dailyData[date] || 0) + sale.total;
    });

    const sortedDates = Object.keys(dailyData).sort();
    const dailyLabels = sortedDates;
    const dailyValues = sortedDates.map(date => dailyData[date]);

    const dailyCtx = document.getElementById('daily-trend-chart').getContext('2d');
    if (dailyTrendChart) {
        dailyTrendChart.destroy();
    }
    dailyTrendChart = new Chart(dailyCtx, {
        type: 'line',
        data: {
            labels: dailyLabels,
            datasets: [{
                label: `Daily Sales (${systemSettings.currency})`,
                data: dailyValues,
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });

    // Weekly comparison (simplified)
    const weeklyData = { 'Mon': 0, 'Tue': 0, 'Wed': 0, 'Thu': 0, 'Fri': 0, 'Sat': 0, 'Sun': 0 };
    filteredSales.forEach(sale => {
        const date = new Date(sale.date);
        const day = date.toLocaleDateString('en-US', { weekday: 'short' });
        weeklyData[day] += sale.total;
    });

    const weeklyCtx = document.getElementById('weekly-chart').getContext('2d');
    if (weeklyChart) {
        weeklyChart.destroy();
    }
    weeklyChart = new Chart(weeklyCtx, {
        type: 'bar',
        data: {
            labels: Object.keys(weeklyData),
            datasets: [{
                label: `Weekly Sales (${systemSettings.currency})`,
                data: Object.values(weeklyData),
                backgroundColor: 'rgba(255, 193, 7, 0.2)',
                borderColor: 'rgba(255, 193, 7, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });

    // Calculate trend metrics
    const maxDaily = Math.max(...dailyValues);
    const bestDayIndex = dailyValues.indexOf(maxDaily);
    const bestDay = bestDayIndex >= 0 ? dailyLabels[bestDayIndex] : 'N/A';

    document.getElementById('best-day').textContent = bestDay;
    document.getElementById('best-day-amount').textContent = maxDaily.toFixed(2);

    // Peak hour (simplified - based on invoice time)
    const hourlySales = {};
    filteredSales.forEach(sale => {
        if (sale.time) {
            const hour = sale.time.split(':')[0];
            hourlySales[hour] = (hourlySales[hour] || 0) + sale.total;
        }
    });

    const peakHour = Object.keys(hourlySales).reduce((a, b) =>
        hourlySales[a] > hourlySales[b] ? a : b, 'N/A');

    document.getElementById('peak-hour').textContent = peakHour !== 'N/A' ? `${peakHour}:00` : 'N/A';
    document.getElementById('peak-hour-amount').textContent = hourlySales[peakHour] ?
        hourlySales[peakHour].toFixed(2) : '0.00';

    // Growth rate (simplified)
    document.getElementById('growth-rate').textContent = filteredSales.length > 0 ? '+12%' : '0%';

    // Top customer
    const customerSales = {};
    filteredSales.forEach(sale => {
        const customer = sale.customer || 'Walk-in';
        customerSales[customer] = (customerSales[customer] || 0) + sale.total;
    });

    const topCustomer = Object.keys(customerSales).reduce((a, b) =>
        customerSales[a] > customerSales[b] ? a : b, 'N/A');

    document.getElementById('top-customer').textContent = topCustomer;
    document.getElementById('top-customer-amount').textContent = customerSales[topCustomer] ?
        customerSales[topCustomer].toFixed(2) : '0.00';
}

// Tab switching
function switchReportTab(tabName) {
    document.querySelectorAll('.report-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-report="${tabName}"]`).classList.add('active');

    document.querySelectorAll('.report-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
}

// Dashboard
let dashboardChart = null;

function updateDashboard() {
    // Update metrics
    updateDashboardMetrics();

    // Update charts
    updateDashboardCharts();

    // Update recent activity
    updateRecentActivity();

    // Update low stock alerts
    updateLowStockAlerts();

    // Update today's summary
    updateTodaysSummary();
}

function updateDashboardMetrics() {
    const totalSales = sales.reduce((sum, sale) => sum + sale.total, 0);
    const totalOrders = sales.length;
    const totalProducts = products.length;
    const lowStockItems = products.filter(p => (p.stock || 0) <= (p.minStock || 0)).length;

    document.getElementById('dashboard-total-sales').textContent = systemSettings.currency + totalSales.toFixed(2);
    document.getElementById('dashboard-total-orders').textContent = totalOrders;
    document.getElementById('dashboard-total-products').textContent = totalProducts;
    document.getElementById('dashboard-low-stock').textContent = lowStockItems;

    // Calculate percentage changes (simplified - you could make this more sophisticated)
    const salesChange = totalSales > 0 ? '+12%' : '+0%'; // Placeholder logic
    const ordersChange = totalOrders > 0 ? '+8%' : '+0%';
    const productsChange = totalProducts > 0 ? '+5%' : '+0%';
    const lowStockChange = lowStockItems > 0 ? `+${lowStockItems}` : '+0';

    document.getElementById('sales-change').textContent = salesChange;
    document.getElementById('orders-change').textContent = ordersChange;
    document.getElementById('products-change').textContent = productsChange;
    document.getElementById('low-stock-change').textContent = lowStockChange;
}

function updateDashboardCharts() {
    // Monthly sales chart
    const monthlyData = getMonthlySalesData();
    const ctx = document.getElementById('dashboard-sales-chart').getContext('2d');

    if (dashboardChart) {
        dashboardChart.destroy();
    }

    dashboardChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: monthlyData.labels,
            datasets: [{
                label: `Monthly Sales (${systemSettings.currency})`,
                data: monthlyData.data,
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });

    // Top products list
    updateTopProductsList();
}

function getMonthlySalesData() {
    const monthlySales = {};
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();

    // Initialize last 12 months
    for (let i = 11; i >= 0; i--) {
        const date = new Date(currentYear, currentDate.getMonth() - i, 1);
        const key = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        monthlySales[key] = 0;
    }

    // Aggregate sales by month
    sales.forEach(sale => {
        const saleDate = new Date(sale.date);
        const key = saleDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        if (monthlySales.hasOwnProperty(key)) {
            monthlySales[key] += sale.total;
        }
    });

    return {
        labels: Object.keys(monthlySales),
        data: Object.values(monthlySales)
    };
}

function updateTopProductsList() {
    const productSales = {};

    // Aggregate sales by product
    sales.forEach(sale => {
        if (sale.items) {
            sale.items.forEach(item => {
                const productName = item.product.name;
                if (!productSales[productName]) {
                    productSales[productName] = {
                        quantity: 0,
                        revenue: 0
                    };
                }
                productSales[productName].quantity += item.qty;
                productSales[productName].revenue += item.product.sellingPrice * item.qty;
            });
        }
    });

    // Sort by revenue and get top 5
    const topProducts = Object.entries(productSales)
        .sort(([,a], [,b]) => b.revenue - a.revenue)
        .slice(0, 5);

    const topProductsList = document.getElementById('top-products-list');
    topProductsList.innerHTML = '';

    if (topProducts.length === 0) {
        topProductsList.innerHTML = '<p class="no-data">No sales data available</p>';
        return;
    }

    topProducts.forEach(([productName, data], index) => {
        const productDiv = document.createElement('div');
        productDiv.className = 'product-rank';
        productDiv.innerHTML = `
            <div class="rank">${index + 1}</div>
            <div class="product-info">
                <h4>${productName}</h4>
                <p>${data.quantity} units sold</p>
            </div>
            <div class="sales-amount">${systemSettings.currency}${data.revenue.toFixed(2)}</div>
        `;
        topProductsList.appendChild(productDiv);
    });
}

function updateQuickProducts() {
    quickProductsList.innerHTML = '';
    // Show top 8 products by stock or recently added
    const quickProducts = products.slice(0, 8); // For simplicity, first 8 products

    quickProducts.forEach(product => {
        const btn = document.createElement('button');
        btn.className = 'quick-product-btn';
        btn.onclick = () => addToCart(product);
        btn.innerHTML = `
            <span class="product-name">${product.name}</span>
            <span class="product-price">₹${(product.sellingPrice || product.price || 0).toFixed(2)}</span>
        `;
        quickProductsList.appendChild(btn);
    });
}

function saveCustomer() {
    const name = document.getElementById('customer-name').value.trim();
    const phone = document.getElementById('customer-phone').value.trim();
    if (!name) {
        alert('Enter customer name');
        return;
    }
    const customer = { id: Date.now(), name, phone, createdAt: new Date().toISOString() };
    customers.push(customer);
    saveUserData(currentUser, 'customers', customers).catch(error => console.error('Failed to save customers:', error));
    alert('Customer saved');
}

function loadCustomer() {
    if (customers.length === 0) {
        alert('No customers saved');
        return;
    }
    const customerNames = customers.map(c => c.name).join('\n');
    const selectedName = prompt(`Select customer:\n${customerNames}`);
    if (selectedName) {
        const customer = customers.find(c => c.name === selectedName);
        if (customer) {
            document.getElementById('customer-name').value = customer.name;
            document.getElementById('customer-phone').value = customer.phone;
        }
    }
}

function updateRecentActivity() {
    const recentSalesList = document.getElementById('recent-sales-list');
    recentSalesList.innerHTML = '';

    // Get last 5 sales
    const recentSales = sales.slice(-5).reverse();

    if (recentSales.length === 0) {
        recentSalesList.innerHTML = '<p class="no-data">No recent sales</p>';
        return;
    }

    recentSales.forEach(sale => {
        const saleDiv = document.createElement('div');
        saleDiv.className = 'activity-item';
        saleDiv.innerHTML = `
            <div class="activity-title">Invoice #${sale.id} - ${sale.customer}</div>
            <div class="activity-details">${sale.date} • ${sale.items.length} items</div>
            <div class="activity-amount">
                <span>${systemSettings.currency}${sale.total.toFixed(2)}</span>
                <button onclick="reprintBillById(${sale.id})" class="print-btn" title="Print Receipt"><i class="fas fa-print"></i></button>
            </div>
        `;
        recentSalesList.appendChild(saleDiv);
    });
}

function updateLowStockAlerts() {
    const lowStockAlerts = document.getElementById('low-stock-alerts');
    lowStockAlerts.innerHTML = '';

    const lowStockProducts = products.filter(p => (p.stock || 0) <= (p.minStock || 0));

    if (lowStockProducts.length === 0) {
        lowStockAlerts.innerHTML = '<p class="no-data">All items are well stocked</p>';
        return;
    }

    lowStockProducts.forEach(product => {
        const alertDiv = document.createElement('div');
        alertDiv.className = 'activity-item';
        alertDiv.innerHTML = `
            <div class="activity-title">${product.name}</div>
            <div class="activity-details">Stock: ${product.stock || 0} units (Min: ${product.minStock || 0})</div>
            <div class="activity-amount" style="color: #dc3545;">Low Stock</div>
        `;
        lowStockAlerts.appendChild(alertDiv);
    });
}

function updateTodaysSummary() {
    const today = new Date().toLocaleDateString();
    const todaysSales = sales.filter(sale => sale.date === today);

    const todaySales = todaysSales.reduce((sum, sale) => sum + sale.total, 0);
    const todayOrders = todaysSales.length;
    const avgOrderToday = todayOrders > 0 ? todaySales / todayOrders : 0;
    const todayGst = todaysSales.reduce((sum, sale) => sum + sale.gst, 0);

    document.getElementById('today-sales').textContent = systemSettings.currency + todaySales.toFixed(2);
    document.getElementById('today-orders').textContent = todayOrders;
    document.getElementById('avg-order-today').textContent = systemSettings.currency + avgOrderToday.toFixed(2);
    document.getElementById('today-gst').textContent = systemSettings.currency + todayGst.toFixed(2);
}

// Export CSV
exportCsvBtn.addEventListener('click', () => {
    const filteredSales = getFilteredSales();
    let csv = 'Date,Time,Invoice ID,Customer,Phone,Payment,Items,Subtotal,Discount %,Discount Flat,GST,Total,Paid,Balance\n';
    filteredSales.forEach(sale => {
        csv += `${sale.date},${sale.time || ''},${sale.id},${sale.customer},${sale.phone || ''},${sale.payment || 'Cash'},${sale.items ? sale.items.length : 0},${sale.subtotal.toFixed(2)},${sale.discountPercent || 0},${sale.discountFlat || 0},${sale.gst.toFixed(2)},${sale.total.toFixed(2)},${sale.paid || 0},${sale.balance || 0}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', `sales_report_${currentStartDate || 'all'}_to_${currentEndDate || 'now'}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});

// Print Report
document.getElementById('print-report').addEventListener('click', () => {
    window.print();
});

// Authentication
function checkLoginStatus() {
    const userId = sessionStorage.getItem('currentUserId');
    if (userId) {
        // Try to load user data
        initUsersDB().then(() => {
            // Load user data and show app
            loadUserData({ id: userId }).then(() => {
                showApp();
            }).catch(() => {
                showAuthForms();
            });
        });
    } else {
        showAuthForms();
    }
}

function showAuthForms() {
    authContainer.style.display = 'flex';
    app.style.display = 'none';
    showLoginForm();
}

function showLoginForm() {
    document.getElementById('login-form').classList.add('active');
    document.getElementById('signup-form').classList.remove('active');
}

function showSignupForm() {
    document.getElementById('login-form').classList.remove('active');
    document.getElementById('signup-form').classList.add('active');
}

function showApp() {
    authContainer.style.display = 'none';
    app.style.display = 'block';
    updateUserDisplay();
    initializeUserApp();
}

function login(email, password) {
    return loginUser(email, password);
}

function logout() {
    if (developmentMode) {
        devLogout();
        return;
    }

    const { signOut } = window.firebaseFunctions;
    signOut(window.firebaseAuth).then(() => {
        // Reset user data
        currentUser = null;
        products = [];
        sales = [];
        categories = ['Groceries', 'Beverages', 'Snacks', 'Household', 'Personal Care', 'Electronics', 'Other'];
        cart = [];
        heldBills = [];
        shopDetails = {};
        systemSettings = {
            currency: '₹',
            defaultGst: 18.00,
            itemsPerPage: 6,
            theme: 'light',
            autoBackup: true,
            printReceipt: false
        };
    }).catch((error) => {
        console.error('Logout error:', error);
    });
}

function changePassword(currentPassword, newPassword) {
    if (!currentUser) return false;

    if (currentUser.password !== currentPassword) {
        return false; // Current password incorrect
    }

    currentUser.password = newPassword;

    // Update in users database
    return new Promise((resolve) => {
        if (!usersDb) {
            resolve(false);
            return;
        }

        const transaction = usersDb.transaction(['users'], 'readwrite');
        const store = transaction.objectStore('users');
        const request = store.put(currentUser);

        request.onsuccess = () => resolve(true);
        request.onerror = () => resolve(false);
    });
}

function updateUserDisplay() {
    if (currentUser) {
        // Update header to show current user
        const headerH1 = document.querySelector('header h1');
        const displayName = currentUser.displayName || currentUser.email || 'User';
        headerH1.textContent = `${shopDetails.name || 'POS System'} - ${displayName}`;
    }
}



function loadShopDetails() {
    // Shop details are now loaded from Firebase in loadUserData
    updateShopDisplay();
}

function loadSystemSettings() {
    // System settings are now loaded from Firebase in loadUserData
    applySystemSettings();
}

function saveShopDetails() {
    if (currentUser) {
        saveUserData(currentUser, 'shopDetails', shopDetails).catch(error => console.error('Failed to save shop details:', error));
    }
}

function saveSystemSettings() {
    if (currentUser) {
        saveUserData(currentUser, 'systemSettings', systemSettings).catch(error => console.error('Failed to save system settings:', error));
    }
    applySystemSettings();
}

function saveSystemSettings() {
    if (currentUser) {
        saveUserData(currentUser, 'systemSettings', systemSettings);
    }
    applySystemSettings();
}

function applySystemSettings() {
    // Apply currency
    document.querySelectorAll('.currency-symbol').forEach(el => {
        el.textContent = systemSettings.currency;
    });

    // Apply theme
    document.body.className = systemSettings.theme === 'dark' ? 'dark-theme' : '';

    // Apply items per page
    itemsPerPage = systemSettings.itemsPerPage;
}

function checkLoginStatus() {
    // Firebase auth state observer will handle this automatically
    // Just initialize the observer if not already done
    if (!firebaseReady) return;
    initializeAuthStateObserver();
}

function showLoginForm() {
    authContainer.style.display = 'flex';
    app.style.display = 'none';
    document.getElementById('login-form').classList.add('active');
    document.getElementById('signup-form').classList.remove('active');
}

function showApp() {
    authContainer.style.display = 'none';
    app.style.display = 'block';
    updateUserDisplay();
    initializeUserApp();
}

function logout() {
    const { signOut } = window.firebaseFunctions;
    signOut(window.firebaseAuth).then(() => {
        // Reset user data
        currentUser = null;
        products = [];
        sales = [];
        categories = ['Groceries', 'Beverages', 'Snacks', 'Household', 'Personal Care', 'Electronics', 'Other'];
        cart = [];
        heldBills = [];
        shopDetails = {};
        systemSettings = {
            currency: '₹',
            defaultGst: 18.00,
            itemsPerPage: 6,
            theme: 'light',
            autoBackup: true,
            printReceipt: false
        };
    }).catch((error) => {
        console.error('Logout error:', error);
    });
}

function changePassword(newPassword) {
    if (!currentUser) return Promise.reject(new Error('No user logged in'));

    // Firebase handles password updates through Auth
    // For now, we'll just update the user profile data
    // Note: Firebase requires re-authentication for password changes
    return Promise.resolve(true);
}





function logout() {
    sessionStorage.removeItem('posLoggedIn');
    sessionStorage.removeItem('currentUser');
    showLoginForm();
    // Clear cart on logout
    cart = [];
    displayCart();
}

function changePassword(newPassword) {
    if (!currentUser) return Promise.reject(new Error('No user logged in'));

    // Firebase handles password updates through Auth
    // For now, we'll just update the user profile data
    // Note: Firebase requires re-authentication for password changes
    return Promise.resolve(true);
}

function updateUserDisplay() {
    if (currentUser) {
        // Update header to show current user
        const headerH1 = document.querySelector('header h1');
        const displayName = currentUser.displayName || currentUser.email || 'User';
        headerH1.textContent = `${shopDetails.name || 'POS System'} - ${displayName}`;
    }
}

function updateShopDisplay() {
    // Update header with shop name
    updateUserDisplay();

    // Update currency symbols throughout the app
    document.querySelectorAll('.currency-symbol').forEach(el => {
        el.textContent = systemSettings.currency;
    });

    // Update any hardcoded currency references in reports
    const currencyPattern = new RegExp('₹', 'g');
    document.querySelectorAll('*').forEach(el => {
        if (el.children.length === 0 && el.textContent && el.textContent.includes('₹')) {
            el.textContent = el.textContent.replace(currencyPattern, systemSettings.currency);
        }
    });
}

// Settings Tabs
function switchSettingsTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update tab content
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
}

function populateSettingsForms() {
    // Shop details
    document.getElementById('shop-name').value = shopDetails.name || '';
    document.getElementById('shop-phone').value = shopDetails.phone || '';
    document.getElementById('shop-address').value = shopDetails.address || '';
    document.getElementById('shop-email').value = shopDetails.email || '';
    document.getElementById('shop-gst').value = shopDetails.gst || '';
    document.getElementById('shop-logo').value = shopDetails.logo || '';

    // System settings
    document.getElementById('currency').value = systemSettings.currency;
    document.getElementById('default-gst').value = systemSettings.defaultGst;
    document.getElementById('items-per-page').value = systemSettings.itemsPerPage;
    document.getElementById('theme').value = systemSettings.theme;
    document.getElementById('auto-backup').checked = systemSettings.autoBackup;
    document.getElementById('print-receipt').checked = systemSettings.printReceipt;
}

// Settings Modal
function showSettingsModal() {
    populateSettingsForms();
    document.getElementById('settings-modal').style.display = 'block';
}

function hideSettingsModal() {
    document.getElementById('settings-modal').style.display = 'none';
    document.getElementById('change-password-form').reset();
}

// Initialize
function initializeApp() {
    if (firebaseReady) {
        initializeAuthStateObserver();
    }
}

function initializeUserApp() {
    updateCategorySelect();
    updateFilterCategory();
    displayProducts('', '', 'name', 1);
    displayReports();
    updateDashboard();
    showSection('dashboard');

    // Setup logout button
    const header = document.querySelector('header');
    logoutBtn.textContent = 'Logout';
    logoutBtn.style.cssText = 'background: #dc3545; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; margin-left: auto;';
    logoutBtn.addEventListener('click', logout);
    header.insertBefore(logoutBtn, header.querySelector('nav'));

    applySystemSettings();
}

// Backup Now
document.getElementById('backup-now-btn').addEventListener('click', () => {
    const data = {
        products,
        sales,
        categories,
        heldBills,
        exportDate: new Date().toISOString(),
        backupType: 'manual'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pos-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    alert('Backup created successfully!');
});

// Export/Import Data
document.getElementById('export-data-btn').addEventListener('click', () => {
    const data = {
        products,
        sales,
        categories,
        heldBills,
        exportDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pos-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('import-data-btn').addEventListener('click', () => {
    document.getElementById('import-data-input').click();
});

document.getElementById('import-data-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && confirm('This will replace all current data. Continue?')) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.products && data.sales && data.categories && data.heldBills) {
                    products = data.products;
                    sales = data.sales;
                    categories = data.categories;
                    heldBills = data.heldBills;
                    saveAllToIndexedDB();
                    updateCategorySelect();
                    updateFilterCategory();
                    displayProducts('', '', 'name', 1);
                    displayReports();
                    alert('Data imported successfully!');
                } else {
                    alert('Invalid data format');
                }
            } catch (error) {
                alert('Error importing data: ' + error.message);
            }
        };
        reader.readAsText(file);
    }
});

// Backup on exit
window.addEventListener('beforeunload', (e) => {
    // Auto-backup data before leaving
    const data = {
        products,
        sales,
        categories,
        heldBills,
        exportDate: new Date().toISOString(),
        autoBackup: true
    };

    // Store in sessionStorage as a temporary backup
    try {
        sessionStorage.setItem('pos-auto-backup', JSON.stringify(data));
        console.log('Auto-backup created');
    } catch (error) {
        console.warn('Could not create auto-backup:', error);
    }

    // Show confirmation dialog only if there are unsaved changes
    if (cart.length > 0 || heldBills.length > 0) {
        e.preventDefault();
        e.returnValue = 'You have unsaved cart items or held bills. Sure you want to leave?';
        return e.returnValue;
    }
});

// Restore auto-backup on load if available
function restoreAutoBackup() {
    // Auto-backup restoration is handled differently with Firebase
    // Firebase automatically syncs data, so we don't need manual restoration
    console.log('Firebase handles data synchronization automatically');
}

// Periodic auto-save
let autoSaveEnabled = true;
setInterval(() => {
    if (currentUser && autoSaveEnabled && systemSettings.autoBackup) {
        saveAllToUserDB().then(() => {
            console.log('Auto-saved at', new Date().toLocaleTimeString());
        }).catch((error) => {
            console.warn('Auto-save failed:', error);
            // Disable auto-save after repeated failures to prevent spam
            autoSaveEnabled = false;
            console.warn('Auto-save disabled due to repeated failures');
        });
    }
}, 5 * 60 * 1000); // Save every 5 minutes

// Update timestamp on manual saves too
function updateLastSaved() {
    document.getElementById('last-saved').textContent = new Date().toLocaleTimeString();
}

// Modal close functionality
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('settings-modal');
    const closeBtn = document.querySelector('.close-modal');

    if (closeBtn) {
        closeBtn.addEventListener('click', hideSettingsModal);
    }

    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            hideSettingsModal();
        }
    });

    // Settings tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchSettingsTab(tabName);
        });
    });

    // Reports tab switching
    document.querySelectorAll('.report-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.report;
            switchReportTab(tabName);
        });
    });

    // Date filtering
    document.getElementById('apply-filters').addEventListener('click', () => {
        currentStartDate = document.getElementById('report-start-date').value;
        currentEndDate = document.getElementById('report-end-date').value;
        displayReports();
    });

    document.getElementById('reset-filters').addEventListener('click', () => {
        currentStartDate = null;
        currentEndDate = null;
        document.getElementById('report-start-date').value = '';
        document.getElementById('report-end-date').value = '';
        displayReports();
    });

    // Set default date range to last 30 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    document.getElementById('report-start-date').value = startDate.toISOString().split('T')[0];
    document.getElementById('report-end-date').value = endDate.toISOString().split('T')[0];

    currentStartDate = startDate.toISOString().split('T')[0];
    currentEndDate = endDate.toISOString().split('T')[0];
});

// Change password form handler
document.getElementById('change-password-form').addEventListener('submit', (e) => {
    e.preventDefault();

    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (newPassword !== confirmPassword) {
        alert('New passwords do not match');
        return;
    }

    if (newPassword.length < 6) {
        alert('New password must be at least 6 characters long');
        return;
    }

    alert('Password changes are managed through your Firebase account settings. Please use the password reset feature or contact support for password changes.');
    hideSettingsModal();
});

// Shop details form handler
document.getElementById('shop-details-form').addEventListener('submit', (e) => {
    e.preventDefault();

    shopDetails = {
        name: document.getElementById('shop-name').value,
        phone: document.getElementById('shop-phone').value,
        address: document.getElementById('shop-address').value,
        email: document.getElementById('shop-email').value,
        gst: document.getElementById('shop-gst').value,
        logo: document.getElementById('shop-logo').value
    };

    saveShopDetails();
    updateShopDisplay();
    alert('Shop details saved successfully!');
});

    // System settings form handler
    document.getElementById('system-settings-form').addEventListener('submit', (e) => {
        e.preventDefault();

        systemSettings.currency = document.getElementById('currency').value;
        systemSettings.defaultGst = parseFloat(document.getElementById('default-gst').value) || 18.00;
        systemSettings.itemsPerPage = parseInt(document.getElementById('items-per-page').value) || 6;
        systemSettings.theme = document.getElementById('theme').value;
        systemSettings.autoBackup = document.getElementById('auto-backup').checked;
        systemSettings.printReceipt = document.getElementById('print-receipt').checked;

        saveSystemSettings();
        alert('System settings saved successfully!');
    });

    // Reset database handler
    document.getElementById('reset-database').addEventListener('click', () => {
        if (confirm('This will permanently delete all your data and reset your account. Are you sure?')) {
            resetUserDB().then(() => {
                // Reset all data arrays
                products = [];
                sales = [];
                categories = ['Groceries', 'Beverages', 'Snacks', 'Household', 'Personal Care', 'Electronics', 'Other'];
                heldBills = [];
                shopDetails = {};
                systemSettings = {
                    currency: '₹',
                    defaultGst: 18.00,
                    itemsPerPage: 6,
                    theme: 'light',
                    autoBackup: true,
                    printReceipt: false
                };

                // Reinitialize user app
                initializeUserApp();
                alert('Database reset successfully! All your data has been cleared.');
            });
        }
    });

// Auth form handlers
document.getElementById('show-signup').addEventListener('click', (e) => {
    e.preventDefault();
    showSignupForm();
});

document.getElementById('show-login').addEventListener('click', (e) => {
    e.preventDefault();
    showLoginForm();
});

loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    login(email, password).then(() => {
        document.getElementById('login-username').value = '';
        document.getElementById('login-password').value = '';
    }).catch((error) => {
        alert(error.message || 'Login failed');
    });
});

signupForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const firstName = document.getElementById('signup-firstname').value;
    const lastName = document.getElementById('signup-lastname').value;
    const username = document.getElementById('signup-username').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm-password').value;

    if (password !== confirmPassword) {
        alert('Passwords do not match');
        return;
    }

    if (password.length < 6) {
        alert('Password must be at least 6 characters long');
        return;
    }

    const userData = {
        firstName,
        lastName,
        username,
        email,
        password,
        role: 'user' // Default role for new users
    };

    registerUser(userData).then(() => {
        alert('Account created successfully! You will be automatically logged in.');
        showLoginForm();
        signupForm.reset();
    }).catch((error) => {
        alert(error.message || 'Registration failed');
    });
});

initializeApp();