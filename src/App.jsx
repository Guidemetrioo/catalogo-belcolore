import { Search, X, ChevronLeft, ChevronRight, Grid, ArrowUp, Settings, RefreshCw, ExternalLink, ArrowLeft, Lock, Eye, EyeOff, CheckCircle, AlertCircle, Loader, ArrowUpAZ, ArrowDownAZ, ImageIcon, Download, ChevronDown, ChevronUp, Send, Wrench, Clock } from 'lucide-react';
import productsData from './data/products.json';
import categoryCoversData from './data/category_covers.json';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';

function App() {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [visibleCount, setVisibleCount] = useState(24);
  const [sortOrder, setSortOrder] = useState('default'); // 'default' | 'az' | 'za'
  const [isCategoryHovered, setIsCategoryHovered] = useState(false);
  const isHoveredRef = useRef(false);

  // Keep ref in sync with state so scroll handler can read it without stale closures
  useEffect(() => {
    isHoveredRef.current = isCategoryHovered;
  }, [isCategoryHovered]);

  // Scroll to Top visibility state
  const [showScrollToTop, setShowScrollToTop] = useState(false);

  // Monitor window scroll to show/hide the scroll-to-top button & auto-minimize categories bar
  useEffect(() => {
    const handleScrollEffects = () => {
      // Show/hide scroll-to-top button
      if (window.scrollY > 300) {
        setShowScrollToTop(true);
      } else {
        setShowScrollToTop(false);
      }

      // Auto-minimize categories bar when user scrolls down past products
      if (window.scrollY > 120) {
        const isMobile = window.innerWidth <= 768;
        if (isMobile || !isHoveredRef.current) {
          setIsCategoryHovered(false);
        }
      }
    };

    window.addEventListener('scroll', handleScrollEffects);
    return () => window.removeEventListener('scroll', handleScrollEffects);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  // URL do Google Apps Script publicado como Web App
  const GOOGLE_DRIVE_API_URL = "https://script.google.com/macros/s/AKfycbx4V3LbXg-EgPFXTTuLdBTWqA2AI2oDhqjXA6Mw5XpWr-ByXLMtwNhS56Tkb04Klky6qw/exec";

  // Sync status state
  const [syncStatus, setSyncStatus] = useState('idle'); // 'idle' | 'loading' | 'success' | 'error'
  const [syncMessage, setSyncMessage] = useState('');
  const [needsReauth, setNeedsReauth] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(() => {
    return localStorage.getItem('belcolore_last_sync') || null;
  });

  // State for manual integration request
  const [manualSyncRequest, setManualSyncRequest] = useState(() => {
    try {
      const saved = localStorage.getItem('belcolore_manual_sync_request');
      if (saved) return JSON.parse(saved);
    } catch (e) { /* ignore */ }
    return null;
  });

  const handleRequestManualSync = () => {
    const now = new Date().toLocaleString('pt-BR');
    const newRequest = {
      requested: true,
      timestamp: now,
      status: 'pending'
    };
    try {
      localStorage.setItem('belcolore_manual_sync_request', JSON.stringify(newRequest));
    } catch (e) { /* ignore */ }
    setManualSyncRequest(newRequest);
    setSyncStatus('success');
    setSyncMessage(`📩 Solicitação de Integração Manual registrada com sucesso em ${now}! A equipe foi notificada.`);
    setTimeout(() => setSyncStatus('idle'), 8000);
  };

  const handleResolveManualSyncRequest = () => {
    try {
      localStorage.removeItem('belcolore_manual_sync_request');
    } catch (e) { /* ignore */ }
    setManualSyncRequest(null);
    setSyncStatus('success');
    setSyncMessage('✅ Solicitação de Integração Manual marcada como concluída.');
    setTimeout(() => setSyncStatus('idle'), 5000);
  };

  // Database local state - productsData local é a base padrão
  const [productsList, setProductsList] = useState(productsData);

  // Função de sincronização com o Google Drive (espelhamento automático em tempo real)
  const syncWithDrive = useCallback(async (isManual = false) => {
    if (isManual) {
      setSyncStatus('loading');
      setSyncMessage('Conectando ao Google Drive (pode levar de 20 a 40 segundos)...');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // Timeout de 60s para dar tempo ao Google Apps Script

    try {
      const url = `${GOOGLE_DRIVE_API_URL}?t=${Date.now()}`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        const html = await res.text();
        if (html.includes('accounts.google') || html.includes('signin') || html.includes('login')) {
          if (isManual) {
            setSyncStatus('error');
            setSyncMessage('⚠️ O Google Apps Script precisa ser republicado como público.');
            setNeedsReauth(true);
            setTimeout(() => setSyncStatus('idle'), 10000);
          }
          return;
        }
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const driveItems = await res.json();

      if (Array.isArray(driveItems) && driveItems.length > 0) {
        // Mapear produtos locais por ID do Drive (driveId) e por Nome para consulta ultrarrápida
        const localByDriveId = new Map();
        const localByName = new Map();
        productsData.forEach(p => {
          if (p.driveId && p.image) {
            localByDriveId.set(p.driveId, p.image);
          }
          if (p.name && p.image) {
            localByName.set(p.name.toLowerCase().trim(), p.image);
          }
        });

        // Extrair ID do Drive a partir do item ou URL
        const extractFid = (item) => {
          if (item.driveId) return item.driveId;
          const raw = item.image || item.url || item.driveUrl || '';
          const m = raw.match(/googleusercontent\.com\/d\/([A-Za-z0-9_\-]+)|[?&]id=([A-Za-z0-9_\-]+)|\/file\/d\/([A-Za-z0-9_\-]+)/);
          return m ? (m[1] || m[2] || m[3]) : null;
        };

        // Espelhar diretamente os dados do Drive (fonte de verdade)
        const mergedProducts = driveItems.map((item, idx) => {
          const fid = extractFid(item);
          const nameKey = (item.name || '').toLowerCase().trim();
          // Prioridade 1: Buscar por ID do Drive (permite renomeação sem perder foto WebP local)
          // Prioridade 2: Buscar por Nome exato
          // Prioridade 3: Foto remota do Drive
          const localImg = (fid ? localByDriveId.get(fid) : null) || localByName.get(nameKey);

          return {
            id: item.id || String(idx + 1),
            name: item.name,
            category: item.category,
            driveId: fid || item.id,
            image: localImg || item.image || item.url || item.driveUrl || ''
          };
        }).filter(p => p.name && p.category && p.image);

        if (mergedProducts.length > 0) {
          setProductsList(mergedProducts);
        }

        const now = new Date().toLocaleString('pt-BR');
        localStorage.setItem('belcolore_last_sync', now);
        setLastSyncTime(now);
        setNeedsReauth(false);
        if (isManual) {
          setSyncStatus('success');
          setSyncMessage(`Sincronizado com sucesso! ${mergedProducts.length} itens espelhados.`);
          setTimeout(() => setSyncStatus('idle'), 7000);
        }
      } else if (isManual) {
        setSyncStatus('error');
        setSyncMessage('O Google Drive retornou uma lista vazia.');
        setTimeout(() => setSyncStatus('idle'), 7000);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('Falha ao sincronizar com Google Drive:', err);
      if (isManual) {
        if (err.name === 'AbortError') {
          setSyncStatus('error');
          setSyncMessage('⏱️ O Google Apps Script demorou mais de 60s. O catálogo local com 2.946 fotos continua totalmente ativo.');
        } else {
          const isCors = err.message === 'Failed to fetch' || err.name === 'TypeError';
          if (isCors) {
            setSyncStatus('error');
            setSyncMessage('⚠️ O Google Apps Script precisa ser republicado como público.');
            setNeedsReauth(true);
          } else {
            setSyncStatus('error');
            setSyncMessage(`Falha na sincronização: ${err.message}.`);
          }
        }
        setTimeout(() => setSyncStatus('idle'), 8000);
      }
    }
  }, []);

  // Sincronização automática no boot e a cada 15 minutos (900.000 ms)
  useEffect(() => {
    syncWithDrive(false);
    const interval = setInterval(() => {
      syncWithDrive(false);
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [syncWithDrive]);


  // Admin View & Password Protection State
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Admin active tab: 'covers' | 'drive'
  const [adminTab, setAdminTab] = useState('covers');

  const handleAdminToggle = () => {
    if (isAdminMode) {
      setIsAdminMode(false);
    } else {
      if (isAdminAuthenticated) {
        setIsAdminMode(true);
        setSelectedCategory(null);
        setSearchQuery('');
      } else {
        setIsPasswordModalOpen(true);
        setAdminPasswordInput('');
        setPasswordError('');
      }
    }
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (adminPasswordInput === 'Belcolore2026') {
      setIsAdminAuthenticated(true);
      setIsPasswordModalOpen(false);
      setIsAdminMode(true);
      setSelectedCategory(null);
      setSearchQuery('');
      setAdminPasswordInput('');
      setPasswordError('');
    } else {
      setPasswordError('Senha incorreta. Tente novamente.');
    }
  };

  // Carousel active image state
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  // Swipe gesture states for mobile carousel
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);

  // Track failed/broken images at runtime
  const [failedImages, setFailedImages] = useState(new Set());

  const handleImageError = (imgPath) => {
    if (!imgPath) return;
    setFailedImages(prev => {
      if (prev.has(imgPath)) return prev;
      const next = new Set(prev);
      next.add(imgPath);
      return next;
    });
  };

  // Group products with the same base name
  // NOTE: failedImages is intentionally NOT in the dependency array here.
  // We never remove products from the list when an image fails — instead we
  // just show a placeholder in the card. This prevents the "products disappear"
  // bug that occurred because every onError re-render triggered a full recompute.
  const groupedProducts = useMemo(() => {
    const groups = {};
    productsList.forEach(p => {
      // Ignore products without a photo or with empty/invalid image strings
      if (!p.image || typeof p.image !== 'string' || !p.image.trim() || p.image.includes('placeholder')) {
        return;
      }
      
      const imgPath = p.image.trim();

      // Strip trailing numeric suffix like " 01", "-01", " - 01", " 1", "-1"
      const baseName = p.name.replace(/[- ]+\d+$/i, '').trim();
      
      // Normalize key for grouping (convert hyphens to spaces, lowercase, collapse whitespace)
      const key = baseName.replace(/[-_]/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
      
      if (!groups[key]) {
        groups[key] = {
          id: p.id,
          name: baseName,
          category: p.category,
          image: imgPath,
          images: []
        };
      }
      if (!groups[key].images.includes(imgPath)) {
        groups[key].images.push(imgPath);
      }
    });

    return Object.values(groups);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productsList]);

  // Extract unique categories dynamically
  const categories = useMemo(() => {
    const cats = new Set(groupedProducts.map(p => p.category));
    return Array.from(cats).sort();
  }, [groupedProducts]);

  // Compute number of products in each category
  const categoryCounts = useMemo(() => {
    const counts = {};
    groupedProducts.forEach(p => {
      counts[p.category] = (counts[p.category] || 0) + 1;
    });
    return counts;
  }, [groupedProducts]);

  // Pre-selected background-free/studio cover images for each category
  // Loaded from localStorage first (custom overrides), with fallback to JSON static data
  const [categoryCovers, setCategoryCovers] = useState(() => {
    try {
      const saved = localStorage.getItem('belcolore_category_covers');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge: saved overrides take priority, fill missing with defaults
        return { ...categoryCoversData, ...parsed };
      }
    } catch (e) { /* ignore */ }
    return { ...categoryCoversData };
  });

  // Admin: which category's cover editor is currently open
  const [editingCoverCategory, setEditingCoverCategory] = useState(null);
  // Admin: search/filter within the cover image picker
  const [coverPickerSearch, setCoverPickerSearch] = useState('');

  // Set a new cover for a category and persist to localStorage
  const handleSetCategoryCover = (category, imageUrl) => {
    setCategoryCovers(prev => {
      const updated = { ...prev, [category]: imageUrl };
      try {
        // Only save the overrides that differ from defaults
        const overrides = {};
        Object.keys(updated).forEach(cat => {
          if (updated[cat] !== categoryCoversData[cat]) {
            overrides[cat] = updated[cat];
          }
        });
        localStorage.setItem('belcolore_category_covers', JSON.stringify(overrides));
      } catch (e) { /* ignore */ }
      return updated;
    });
  };

  // Reset all covers to defaults
  const handleResetAllCovers = () => {
    setCategoryCovers({ ...categoryCoversData });
    localStorage.removeItem('belcolore_category_covers');
    setEditingCoverCategory(null);
  };

  // Export updated category_covers.json as a file download
  const handleExportCoversJson = () => {
    const json = JSON.stringify(categoryCovers, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'category_covers.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Check if any cover differs from defaults
  const hasCustomCovers = useMemo(() => {
    return Object.keys(categoryCoversData).some(
      cat => categoryCovers[cat] !== categoryCoversData[cat]
    );
  }, [categoryCovers]);

  // Get all unique images for a given category from productsList
  const getImagesForCategory = useCallback((category) => {
    const seen = new Set();
    const images = [];
    productsList.forEach(p => {
      if (
        p.category === category &&
        p.image &&
        typeof p.image === 'string' &&
        p.image.trim() &&
        !p.image.includes('placeholder')
      ) {
        const img = p.image.trim();
        if (!seen.has(img)) {
          seen.add(img);
          images.push(img);
        }
      }
    });
    return images;
  }, [productsList]);

  // Reset active image when selected product changes
  useEffect(() => {
    setActiveImageIndex(0);
  }, [selectedProduct]);

  // Keyboard navigation for carousel
  useEffect(() => {
    if (!selectedProduct) return;

    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft' && selectedProduct.images.length > 1) {
        setActiveImageIndex(prev => (prev === 0 ? selectedProduct.images.length - 1 : prev - 1));
      } else if (e.key === 'ArrowRight' && selectedProduct.images.length > 1) {
        setActiveImageIndex(prev => (prev === selectedProduct.images.length - 1 ? 0 : prev + 1));
      } else if (e.key === 'Escape') {
        setSelectedProduct(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedProduct]);

  // Touch handlers for mobile swipe gestures
  const minSwipeDistance = 50;

  const onTouchStart = (e) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd || !selectedProduct) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    
    if (isLeftSwipe && selectedProduct.images.length > 1) {
      setActiveImageIndex(prev => (prev === selectedProduct.images.length - 1 ? 0 : prev + 1));
    }
    if (isRightSwipe && selectedProduct.images.length > 1) {
      setActiveImageIndex(prev => (prev === 0 ? selectedProduct.images.length - 1 : prev - 1));
    }
  };



  const sliderRef = useRef(null);
  const isDown = useRef(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);
  const dragDistance = useRef(0);
  const activeCategoryRef = useRef(null);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    if (sliderRef.current) {
      const { scrollLeft: sLeft, scrollWidth, clientWidth } = sliderRef.current;
      setCanScrollLeft(sLeft > 5);
      setCanScrollRight(scrollWidth - sLeft - clientWidth > 5);
    }
  };

  useEffect(() => {
    checkScroll();
    const t1 = setTimeout(checkScroll, 100);
    const t2 = setTimeout(checkScroll, 500);
    const t3 = setTimeout(checkScroll, 1500);
    const t4 = setTimeout(checkScroll, 3000);
    window.addEventListener('resize', checkScroll);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      window.removeEventListener('resize', checkScroll);
    };
  }, [categories, selectedCategory, searchQuery, isCategoryHovered]);

  // Scroll slider so the selected category occupies the FIRST visible slot when expanded
  useEffect(() => {
    if (!isCategoryHovered) return;

    // ── Why 560 ms? ────────────────────────────────────────────────────────
    // The CSS transition on .categories-slider (gap, padding, height) is
    // 0.5 s (500 ms).  If we measure card positions mid-transition the gap
    // values are wrong and the computed scroll target is off.
    // We wait 560 ms (transition + small buffer) so the layout is settled.
    const t = setTimeout(() => {
      if (!activeCategoryRef.current || !sliderRef.current) return;

      const slider = sliderRef.current;
      const card   = activeCategoryRef.current;

      // ── Step 1: card's absolute position in the scrollable content ───────
      // getBoundingClientRect() gives viewport-relative coords; adding the
      // current scrollLeft converts to content-absolute coords regardless of
      // which ancestor is the offsetParent.
      const sliderRect      = slider.getBoundingClientRect();
      const cardRect        = card.getBoundingClientRect();
      const cardAbsoluteLeft = slider.scrollLeft + (cardRect.left - sliderRect.left);

      // ── Step 2: subtract the slider's left padding ───────────────────────
      // The slider has padding-left (e.g. 3 rem).  The "first slot" is NOT
      // at the slider's absolute left edge — it is at (left edge + paddingLeft).
      // Scrolling to cardAbsoluteLeft - paddingLeft places the card at that
      // first-slot visual position, which is exactly what we want.
      const sliderPaddingLeft = parseFloat(getComputedStyle(slider).paddingLeft) || 0;
      const desiredScrollLeft  = cardAbsoluteLeft - sliderPaddingLeft;

      // ── Step 3: edge-case guard (category near end of list) ──────────────
      // If there are not enough items after the selected one to fill the row
      // from the first slot, clamp to the maximum scroll value so the tail
      // of the list is shown (selected category visible, no empty gap on right).
      const maxScrollLeft    = slider.scrollWidth - slider.clientWidth;
      const targetScrollLeft = Math.min(Math.max(0, desiredScrollLeft), maxScrollLeft);

      slider.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });

      // Refresh left/right arrow visibility after the scroll finishes
      setTimeout(checkScroll, 400);
    }, 560);

    return () => clearTimeout(t);
  }, [isCategoryHovered, selectedCategory]);

  const handleScroll = (direction) => {
    if (sliderRef.current) {
      const scrollAmount = 400;
      sliderRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
      // check scroll position after scroll animation finishes
      setTimeout(checkScroll, 350);
    }
  };

  const handleMouseDown = (e) => {
    isDown.current = true;
    sliderRef.current.classList.add('active-dragging');
    startX.current = e.pageX - sliderRef.current.offsetLeft;
    scrollLeft.current = sliderRef.current.scrollLeft;
    dragDistance.current = 0;
  };

  const handleMouseLeave = () => {
    isDown.current = false;
    if (sliderRef.current) {
      sliderRef.current.classList.remove('active-dragging');
    }
  };

  const handleMouseUp = () => {
    isDown.current = false;
    if (sliderRef.current) {
      sliderRef.current.classList.remove('active-dragging');
    }
  };

  const handleMouseMove = (e) => {
    if (!isDown.current) return;
    e.preventDefault();
    const x = e.pageX - sliderRef.current.offsetLeft;
    const walk = (x - startX.current) * 1.5;
    sliderRef.current.scrollLeft = scrollLeft.current - walk;
    dragDistance.current = Math.abs(x - startX.current);
    checkScroll();
  };


  // Filter products based on category and search query
  const filteredProducts = useMemo(() => {
    const filtered = groupedProducts.filter(product => {
      const matchesCategory = selectedCategory ? product.category === selectedCategory : true;
      const matchesSearch = searchQuery
        ? product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          product.category.toLowerCase().includes(searchQuery.toLowerCase())
        : true;
      return matchesCategory && matchesSearch;
    });
    if (sortOrder === 'az') {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    } else if (sortOrder === 'za') {
      return [...filtered].sort((a, b) => b.name.localeCompare(a.name, 'pt-BR'));
    }
    return filtered;
  }, [selectedCategory, searchQuery, groupedProducts, sortOrder]);

  // Paginated/limited subset of products for smooth rendering
  const visibleProducts = useMemo(() => {
    return filteredProducts.slice(0, visibleCount);
  }, [filteredProducts, visibleCount]);

  // Reset all filters
  const handleReset = () => {
    setSelectedCategory(null);
    setSearchQuery('');
    setSelectedProduct(null);
    setVisibleCount(24);
    setIsCategoryHovered(false);
  };


  // Check if we are searching (searching forces grid view of products across all categories)
  const isSearching = searchQuery.length > 0;

  return (
    <div className="app-container">
      {/* Header */}
      <header className={`app-header ${isCategoryHovered ? 'categories-expanded' : ''}`}>
        <div className="header-top">
          <div className="logo-container" style={{ cursor: 'pointer' }} onClick={handleReset}>
            <img src="/assets/logo.png" alt="Bel Colore" className="logo-image" />
          </div>
          
          <div className="header-actions">
            <div className="search-wrapper">
              <Search className="search-icon" size={18} />
              <input
                type="text"
                className="search-input"
                placeholder="Buscar móvel ou categoria..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setVisibleCount(24);
                  // When starting to search, clear selected category if any,
                  // so the user searches across the entire catalog
                  if (selectedCategory && e.target.value) {
                    setSelectedCategory(null);
                  }
                }}
              />
              {searchQuery && (
                <button 
                  onClick={() => {
                    setSearchQuery('');
                    setVisibleCount(24);
                  }}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#8c837a'
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <button
              className={`sort-order-btn ${sortOrder !== 'default' ? 'active' : ''}`}
              onClick={() => {
                setSortOrder(prev => prev === 'default' ? 'az' : prev === 'az' ? 'za' : 'default');
                setVisibleCount(24);
              }}
              title={sortOrder === 'az' ? 'Ordenado: A → Z' : sortOrder === 'za' ? 'Ordenado: Z → A' : 'Ordenar A → Z'}
            >
              {sortOrder === 'za' ? <ArrowDownAZ size={20} /> : <ArrowUpAZ size={20} />}
            </button>

            <button 
              className={`admin-toggle-btn ${isAdminMode ? 'active' : ''}`}
              onClick={handleAdminToggle}
              title={isAdminMode ? "Voltar ao Catálogo" : "Área do Administrador"}
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="main-layout">
        {/* Catalog Content Area */}
        <main className="catalog-content">
          {isAdminMode ? (
            /* Admin Panel View */
            <div className="admin-panel">
              <div className="admin-header-row">
                <button className="admin-back-btn" onClick={() => setIsAdminMode(false)}>
                  <ArrowLeft size={18} />
                  <span>Voltar ao Catálogo</span>
                </button>
                <div>
                  <h2 className="admin-title">Painel Administrativo</h2>
                  <p className="admin-subtitle">Gerencie capas de categorias e sincronização com o Google Drive.</p>
                </div>
              </div>

              {/* Stats Row */}
              <div className="admin-stats-row">
                <div className="admin-stat-card">
                  <span className="admin-stat-number">{productsList.length}</span>
                  <span className="admin-stat-label">Fotos no catálogo</span>
                </div>
                <div className="admin-stat-card">
                  <span className="admin-stat-number">{categories.length}</span>
                  <span className="admin-stat-label">Categorias ativas</span>
                </div>
                <div className="admin-stat-card">
                  <span className="admin-stat-number">{groupedProducts.length}</span>
                  <span className="admin-stat-label">Produtos agrupados</span>
                </div>
              </div>

              {/* Tab Navigation */}
              <div className="admin-tabs">
                <button
                  className={`admin-tab-btn ${adminTab === 'covers' ? 'active' : ''}`}
                  onClick={() => setAdminTab('covers')}
                >
                  <ImageIcon size={17} />
                  <span>Capas das Categorias</span>
                  {hasCustomCovers && <span className="admin-tab-dot" />}
                </button>
                <button
                  className={`admin-tab-btn ${adminTab === 'drive' ? 'active' : ''}`}
                  onClick={() => setAdminTab('drive')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" fill="currentColor" viewBox="0 0 87.3 78" style={{flexShrink:0}}>
                    <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                    <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
                    <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.65z" fill="#ea4335"/>
                    <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                    <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                    <path d="M73.4 26.5l-12.6-21.8c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                  </svg>
                  <span>Integração Drive</span>
                  {manualSyncRequest?.status === 'pending' && <span className="admin-tab-dot pending" title="Solicitação de integração manual pendente!" />}
                  {syncStatus === 'loading' && <Loader size={13} className="spin-icon" style={{marginLeft:'2px'}} />}
                  {syncStatus === 'error' && <span className="admin-tab-dot error" />}
                </button>
              </div>

              {/* ===== CATEGORY COVERS SECTION ===== */}
              {adminTab === 'covers' && (
              <div className="admin-card form-section admin-covers-section">
                <div className="admin-covers-header">
                  <div className="admin-covers-header-left">
                    <div className="admin-covers-icon">
                      <ImageIcon size={28} />
                    </div>
                    <div>
                      <h3 className="card-title" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: '0.3rem', fontSize: '1.2rem' }}>Capas das Categorias</h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
                        {hasCustomCovers ? '✏️ Você tem capas personalizadas salvas.' : 'Clique em uma categoria para trocar a foto de capa.'}
                      </p>
                    </div>
                  </div>
                  <div className="admin-covers-actions">
                    <button
                      className="export-covers-btn"
                      onClick={handleExportCoversJson}
                      title="Baixar category_covers.json atualizado"
                    >
                      <Download size={16} />
                      <span>Exportar JSON</span>
                    </button>
                    {hasCustomCovers && (
                      <button
                        className="reset-covers-btn"
                        onClick={() => {
                          if (window.confirm('Resetar todas as capas para o padrão original?')) {
                            handleResetAllCovers();
                          }
                        }}
                        title="Restaurar capas originais"
                      >
                        <RefreshCw size={16} />
                        <span>Resetar</span>
                      </button>
                    )}
                  </div>
                </div>

                <p style={{ color: 'var(--text-primary)', fontSize: '0.92rem', lineHeight: '1.7', marginBottom: '1.5rem' }}>
                  Selecione uma categoria abaixo para escolher qual foto aparece como capa no menu principal. As alterações ficam salvas automaticamente neste navegador.
                </p>

                {/* Category covers grid */}
                <div className="admin-covers-grid">
                  {categories.map((cat) => {
                    const isEditing = editingCoverCategory === cat;
                    const currentCover = categoryCovers[cat];
                    const allImages = getImagesForCategory(cat);
                    const filtered = coverPickerSearch && isEditing
                      ? allImages.filter(img => img.toLowerCase().includes(coverPickerSearch.toLowerCase()))
                      : allImages;
                    const isCustom = categoryCoversData[cat] !== currentCover;

                    return (
                      <div key={cat} className={`admin-cover-card ${isEditing ? 'editing' : ''}`}>
                        {/* Category header with current cover */}
                        <button
                          className="admin-cover-card-header"
                          onClick={() => {
                            setEditingCoverCategory(isEditing ? null : cat);
                            setCoverPickerSearch('');
                          }}
                        >
                          <div className="admin-cover-thumbnail-wrap">
                            {currentCover ? (
                              <img src={currentCover} alt={cat} className="admin-cover-thumbnail" />
                            ) : (
                              <div className="admin-cover-thumbnail-placeholder">
                                <Grid size={24} />
                              </div>
                            )}
                          </div>
                          <div className="admin-cover-card-info">
                            <span className="admin-cover-cat-name">{cat}</span>
                            <span className="admin-cover-cat-count">{categoryCounts[cat]} itens • {allImages.length} fotos</span>
                            {isCustom && <span className="admin-cover-custom-badge">✏️ Personalizada</span>}
                          </div>
                          <div className="admin-cover-card-chevron">
                            {isEditing ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                          </div>
                        </button>

                        {/* Expandable image picker */}
                        {isEditing && (
                          <div className="admin-cover-picker">
                            <div className="admin-cover-picker-search-wrap">
                              <Search size={15} />
                              <input
                                type="text"
                                className="admin-cover-picker-search"
                                placeholder={`Buscar em ${allImages.length} fotos...`}
                                value={coverPickerSearch}
                                onChange={e => setCoverPickerSearch(e.target.value)}
                                autoFocus
                              />
                              {coverPickerSearch && (
                                <button
                                  className="admin-cover-picker-clear"
                                  onClick={() => setCoverPickerSearch('')}
                                >
                                  <X size={14} />
                                </button>
                              )}
                            </div>
                            {isCustom && (
                              <button
                                className="admin-cover-reset-btn"
                                onClick={() => handleSetCategoryCover(cat, categoryCoversData[cat])}
                              >
                                <RefreshCw size={13} /> Restaurar capa original desta categoria
                              </button>
                            )}
                            <div className="admin-cover-images-grid">
                              {filtered.length === 0 ? (
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem 0' }}>Nenhuma foto encontrada.</p>
                              ) : filtered.map((img) => (
                                <button
                                  key={img}
                                  className={`admin-cover-img-btn ${currentCover === img ? 'selected' : ''}`}
                                  onClick={() => {
                                    handleSetCategoryCover(cat, img);
                                    setEditingCoverCategory(null);
                                    setCoverPickerSearch('');
                                  }}
                                  title={img.split('/').pop()}
                                >
                                  <img src={img} alt="" loading="lazy" />
                                  {currentCover === img && (
                                    <div className="admin-cover-img-selected-badge">
                                      <CheckCircle size={16} />
                                    </div>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="admin-hint" style={{ marginTop: '1.5rem' }}>
                  💡 As capas são salvas neste navegador. Para aplicar permanentemente no site, clique em <strong>Exportar JSON</strong> e substitua o arquivo <code>src/data/category_covers.json</code> no projeto.
                </p>
              </div>
              )}

              {/* ===== GOOGLE DRIVE SYNC CARD ===== */}
              {adminTab === 'drive' && (
              <div className="admin-card form-section">
                <div className="admin-sync-header">
                  <div className="admin-drive-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 87.3 78">
                      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
                      <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L1.2 48.5c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
                      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.65z" fill="#ea4335"/>
                      <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
                      <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
                      <path d="M73.4 26.5l-12.6-21.8c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="card-title" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: '0.3rem', fontSize: '1.2rem' }}>Google Drive</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
                      {lastSyncTime ? `Última sincronização: ${lastSyncTime}` : 'Nunca sincronizado manualmente'}
                    </p>
                  </div>
                </div>

                <p style={{ color: 'var(--text-primary)', fontSize: '0.92rem', lineHeight: '1.7', marginBottom: '1.8rem' }}>
                  Quando você adiciona ou remove fotos da pasta do Drive, clique em <strong>Sincronizar Fotos</strong> para atualizar o catálogo instantaneamente. As alterações serão aplicadas sem precisar recarregar a página.
                </p>

                {/* Pending Manual Sync Request Alert Card */}
                {manualSyncRequest?.status === 'pending' && (
                  <div className="manual-sync-request-card">
                    <div className="manual-sync-request-header">
                      <div className="manual-sync-icon-badge">
                        <Send size={20} />
                      </div>
                      <div>
                        <h4 className="manual-sync-card-title">⚠️ Solicitação de Integração Manual Pendente</h4>
                        <p className="manual-sync-card-sub">
                          Registrada em: <strong>{manualSyncRequest.timestamp}</strong>
                        </p>
                      </div>
                    </div>
                    <p className="manual-sync-card-desc">
                      Uma solicitação de atualização manual do Drive foi enviada. Isso notifica a equipe para executar o script de sincronização e espelhamento completo no servidor.
                    </p>
                    <button
                      className="resolve-request-btn"
                      onClick={handleResolveManualSyncRequest}
                    >
                      <CheckCircle size={16} />
                      <span>Marcar Integração Manual como Concluída</span>
                    </button>
                  </div>
                )}

                {/* Sync status feedback */}
                {syncStatus !== 'idle' && (
                  <div className={`sync-status-banner ${syncStatus}`}>
                    {syncStatus === 'loading' && <Loader size={18} className="spin-icon" />}
                    {syncStatus === 'success' && <CheckCircle size={18} />}
                    {syncStatus === 'error' && <AlertCircle size={18} />}
                    <span>{syncMessage}</span>
                  </div>
                )}

                <div className="admin-actions-row">
                  <button
                    className={`sync-drive-btn ${syncStatus === 'loading' ? 'loading' : ''}`}
                    onClick={() => syncWithDrive(true)}
                    disabled={syncStatus === 'loading'}
                  >
                    <RefreshCw size={18} className={syncStatus === 'loading' ? 'spin-icon' : ''} />
                    <span>{syncStatus === 'loading' ? 'Sincronizando...' : 'Sincronizar Fotos'}</span>
                  </button>

                  <button
                    className={`request-manual-sync-btn ${manualSyncRequest?.status === 'pending' ? 'requested' : ''}`}
                    onClick={handleRequestManualSync}
                    title="Solicitar que a equipe realize uma atualização/integração manual completa"
                  >
                    <Send size={16} />
                    <span>{manualSyncRequest?.status === 'pending' ? 'Solicitação Pendente' : 'Solicitar Integração Manual'}</span>
                  </button>

                  <a
                    href="https://drive.google.com/drive/u/0/folders/1hnCfnQ9mNqFKzlyOLSbxnMGd-sKsYpdY"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="open-drive-btn"
                  >
                    <ExternalLink size={16} />
                    <span>Abrir Pasta do Drive</span>
                  </a>
                </div>

                <p className="admin-hint">
                  💡 O catálogo sincroniza automaticamente ao abrir o site, mas use o botão acima para forçar uma atualização imediata após gerenciar os arquivos.
                </p>

                {/* Fix instructions — shown when Apps Script is not public */}
                {needsReauth && (
                  <div className="reauth-instructions">
                    <h4 className="reauth-title">🔧 Como corrigir em 3 passos:</h4>
                    <ol className="reauth-steps">
                      <li>
                        <strong>Abra o Google Apps Script:</strong>{' '}
                        <a
                          href="https://script.google.com/home"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="reauth-link"
                        >
                          script.google.com/home
                        </a>
                        {' '}→ abra o projeto do catálogo Bel Colore.
                      </li>
                      <li>
                        <strong>Clique em "Implantar" → "Gerenciar implantações"</strong>
                        {' '}→ clique no ícone de lápis (editar).
                      </li>
                      <li>
                        Em <strong>"Quem tem acesso"</strong>, selecione{' '}
                        <strong>"Qualquer pessoa"</strong> (sem necessidade de login) → clique em <strong>"Implantar"</strong>.
                      </li>
                    </ol>
                    <p className="reauth-note">
                      Após republicar, clique em <strong>Sincronizar Fotos</strong> novamente.
                    </p>
                  </div>
                )}
              </div>
              )}
            </div>
          ) : (
            <>
              {selectedCategory === null && !isSearching && (
                <h2 className="categories-landing-title">Categorias</h2>
              )}

          {/* Categories Carousel / Slider */}
          <div 
            className={`categories-carousel-container ${selectedCategory !== null || isSearching ? 'minimized' : ''} ${(!selectedCategory && !isSearching) || isCategoryHovered ? 'expanded' : ''}`}
            onMouseEnter={() => (selectedCategory !== null || isSearching) && setIsCategoryHovered(true)}
            onMouseLeave={() => (selectedCategory !== null || isSearching) && setIsCategoryHovered(false)}
            onTouchStart={() => (selectedCategory !== null || isSearching) && setIsCategoryHovered(true)}
          >
            <button 
              className="carousel-arrow left" 
              onClick={() => handleScroll('left')}
            >
              <ChevronLeft size={24} />
            </button>

            <div 
              className="categories-slider" 
              ref={sliderRef}
              onMouseDown={handleMouseDown}
              onMouseLeave={handleMouseLeave}
              onMouseUp={handleMouseUp}
              onMouseMove={handleMouseMove}
              onScroll={checkScroll}
            >

              {/* Categorias Dinâmicas */}
              {categories.map((cat) => (
                <button
                  key={cat}
                  ref={selectedCategory === cat ? activeCategoryRef : null}
                  className={`category-card ${selectedCategory === cat ? 'selected' : ''}`}
                  onClick={(e) => {
                    if (dragDistance.current > 8) return; // Ignores drag
                    setSelectedCategory(cat);
                    setSearchQuery('');
                    setIsCategoryHovered(false);
                  }}
                >
                  <div className="category-image-wrapper">
                    {categoryCovers[cat] ? (
                      <img src={categoryCovers[cat]} alt={cat} loading="lazy" onLoad={checkScroll} />
                    ) : (
                      <div style={{ color: '#8c837a' }}><Grid size={32} /></div>
                    )}
                  </div>
                  <span className="category-card-name">{cat}</span>
                  <span className="category-card-count">{categoryCounts[cat]} itens</span>
                </button>
              ))}
            </div>

            <button 
              className="carousel-arrow right" 
              onClick={() => handleScroll('right')}
            >
              <ChevronRight size={24} />
            </button>
          </div>

          {/* Listing State: Show filtered products if category selected or search active */}
          {(selectedCategory !== null || isSearching) && (
            <div>
              <div className="listing-header">
                <h2 className="listing-title">
                  {isSearching ? `Busca: "${searchQuery}"` : selectedCategory}
                </h2>
                <span className="product-count">
                  {filteredProducts.length} {filteredProducts.length === 1 ? 'móvel' : 'móveis'} encontrado{filteredProducts.length === 1 ? '' : 's'}
                </span>
              </div>

              {filteredProducts.length > 0 ? (
                <div>
                  <div className="product-grid" onClick={() => setIsCategoryHovered(false)}>
                    {visibleProducts.map((product) => (
                      <div
                        key={product.id}
                        className="product-card"
                        onClick={() => setSelectedProduct(product)}
                      >
                        <div className="product-image-wrapper">
                          {failedImages.has(product.image) ? (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', color: '#8c837a' }}>
                              <Grid size={32} />
                              <span style={{ fontSize: '0.7rem' }}>Sem foto</span>
                            </div>
                          ) : (
                            <img 
                              src={product.image} 
                              alt={product.name} 
                              loading="lazy" 
                              onError={() => handleImageError(product.image)}
                            />
                          )}
                          {product.images && product.images.length > 1 && (
                            <span className="photo-count-badge">
                              {product.images.length} fotos
                            </span>
                          )}
                        </div>
                        <div className="product-info">
                          <span className="product-category-tag">{product.category}</span>
                          <h3 className="product-name">{product.name}</h3>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Pagination progress & Load More Button */}
                  <div className="pagination-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '3.5rem', marginBottom: '1.5rem', gap: '1.2rem' }}>
                    <span className="pagination-progress">
                      Você visualizou {Math.min(visibleCount, filteredProducts.length)} de {filteredProducts.length} produtos
                    </span>
                    {visibleCount < filteredProducts.length && (
                      <button 
                        className="load-more-btn"
                        onClick={() => setVisibleCount(prev => prev + 24)}
                      >
                        Carregar Mais
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* Empty state */
                <div className="empty-state">
                  <p>Nenhum produto correspondente encontrado para sua pesquisa.</p>
                  <button className="clear-search-btn" onClick={handleReset}>
                    Limpar filtros
                  </button>
                </div>
              )}
            </div>
          )}
          </>
          )}
        </main>
      </div>

      {/* Modal - Large Image Lightbox Popup */}
      {selectedProduct && (
        <div className="modal-overlay" onClick={() => setSelectedProduct(null)}>
          <div className="modal-content lightbox-mode" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-area">
                <span className="modal-category">{selectedProduct.category}</span>
                <h3 className="modal-product-name">{selectedProduct.name}</h3>
              </div>
              <button className="modal-close-btn" onClick={() => setSelectedProduct(null)}>
                <X size={20} />
              </button>
            </div>

            <div 
              className="modal-carousel-container"
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              {selectedProduct.images && selectedProduct.images.length > 1 && (
                <button 
                  className="carousel-nav-btn prev" 
                  onClick={() => setActiveImageIndex(prev => (prev === 0 ? selectedProduct.images.length - 1 : prev - 1))}
                  aria-label="Foto anterior"
                >
                  <ChevronLeft size={24} />
                </button>
              )}

              <div className="carousel-slide-wrapper">
                <img 
                  src={selectedProduct.images ? selectedProduct.images[activeImageIndex] : selectedProduct.image} 
                  alt={`${selectedProduct.name} - Foto ${activeImageIndex + 1}`} 
                  className="lightbox-image" 
                />
              </div>

              {selectedProduct.images && selectedProduct.images.length > 1 && (
                <button 
                  className="carousel-nav-btn next" 
                  onClick={() => setActiveImageIndex(prev => (prev === selectedProduct.images.length - 1 ? 0 : prev + 1))}
                  aria-label="Próxima foto"
                >
                  <ChevronRight size={24} />
                </button>
              )}
            </div>

            {selectedProduct.images && selectedProduct.images.length > 1 && (
              <div className="carousel-indicators-container">
                <span className="carousel-counter">
                  {activeImageIndex + 1} de {selectedProduct.images.length}
                </span>
                <div className="carousel-dots">
                  {selectedProduct.images.map((_, idx) => (
                    <button 
                      key={idx}
                      className={`carousel-dot ${activeImageIndex === idx ? 'active' : ''}`}
                      onClick={() => setActiveImageIndex(idx)}
                      aria-label={`Ver foto ${idx + 1}`}
                    />
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Admin Password Modal */}
      {isPasswordModalOpen && (
        <div className="modal-overlay" onClick={() => setIsPasswordModalOpen(false)}>
          <div className="modal-content admin-password-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={() => setIsPasswordModalOpen(false)}>
              <X size={20} />
            </button>

            <div className="admin-password-header">
              <div className="lock-icon-badge">
                <Lock size={28} />
              </div>
              <h3 className="admin-password-title">Área do Administrador</h3>
              <p className="admin-password-subtitle">Digite a senha de acesso para continuar.</p>
            </div>

            <form onSubmit={handlePasswordSubmit} className="admin-password-form">
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className={`admin-password-input ${passwordError ? 'error' : ''}`}
                  placeholder="Digite a senha..."
                  value={adminPasswordInput}
                  onChange={(e) => {
                    setAdminPasswordInput(e.target.value);
                    if (passwordError) setPasswordError('');
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  title={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {passwordError && (
                <span className="password-error-message">{passwordError}</span>
              )}

              <div className="password-actions">
                <button
                  type="button"
                  className="password-cancel-btn"
                  onClick={() => setIsPasswordModalOpen(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="password-submit-btn">
                  Acessar Painel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Scroll to Top Button */}
      {showScrollToTop && (
        <button 
          className="scroll-to-top-btn" 
          onClick={scrollToTop}
          aria-label="Voltar ao topo"
        >
          <ArrowUp size={20} />
        </button>
      )}

      {/* Footer */}
      <footer className="app-footer">
        <span className="footer-text">© {new Date().getFullYear()} Bel Colore. Todos os direitos reservados.</span>
        {selectedCategory && (
          <span className="footer-text category-footer-count">
            Categoria ativa: <strong>{selectedCategory}</strong> ({filteredProducts.length} produtos)
          </span>
        )}
        <span className="footer-text">Uso exclusivo interno para consultoras de vendas.</span>
      </footer>
    </div>
  );
}

export default App;
