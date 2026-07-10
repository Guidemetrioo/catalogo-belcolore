import { Search, X, ChevronLeft, ChevronRight, Grid, ArrowUp, Settings, UploadCloud, Download, Trash2, Plus, ArrowLeft } from 'lucide-react';
import productsData from './data/products.json';
import categoryCoversData from './data/category_covers.json';
import { useState, useMemo, useRef, useEffect } from 'react';

function App() {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [visibleCount, setVisibleCount] = useState(24);
  const [isCategoryHovered, setIsCategoryHovered] = useState(true);
  const isHoveredRef = useRef(true);

  // Keep ref in sync with state
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

      // Auto-minimize categories bar when scrolling down
      if (window.scrollY > 50) {
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

  // URL do seu Google Apps Script publicado como Web App
  // Substitua este link pelo link gerado quando você publicar o script no Google Drive
  const GOOGLE_DRIVE_API_URL = "https://script.google.com/macros/s/AKfycbwraFm5Y6iyMZ52bzWkMa_Kw7169iq9coQRnijucSfGBSAt0yzeBjTlP0c6rfQDAxOT/exec";

  // Database local state with cache (Stale-While-Revalidate pattern)
  const [productsList, setProductsList] = useState(() => {
    try {
      const cached = localStorage.getItem('belcolore_products');
      return cached ? JSON.parse(cached) : productsData;
    } catch (e) {
      return productsData;
    }
  });

  // Fetch updated catalog in background
  useEffect(() => {
    const fetchLatestProducts = async () => {
      // Se ainda for a URL de placeholder, não executa o fetch
      if (GOOGLE_DRIVE_API_URL.includes("AKfycbyWfB6u2g_h1Y3bX8Xn3Mh5D7oY8Z9aBcDeFgHiJkLmNoPqRsTuVwXyZ")) {
        return;
      }
      try {
        const res = await fetch(GOOGLE_DRIVE_API_URL);
        if (!res.ok) throw new Error("Erro ao buscar catálogo do Google Drive");
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setProductsList(data);
          localStorage.setItem('belcolore_products', JSON.stringify(data));
        }
      } catch (err) {
        console.error("Falha ao sincronizar com Google Drive em segundo plano:", err);
      }
    };
    fetchLatestProducts();
  }, []);

  // Admin View State
  const [isAdminMode, setIsAdminMode] = useState(false);

  // Carousel active image state
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  // Swipe gesture states for mobile carousel
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);

  // Group products with the same base name
  const groupedProducts = useMemo(() => {
    const groups = {};
    productsList.forEach(p => {
      // Strip trailing numeric suffix like " 01", "-01", " - 01", " 1", "-1"
      const baseName = p.name.replace(/[- ]+\d+$/i, '').trim();
      
      // Normalize key for grouping (convert hyphens to spaces, lowercase, collapse whitespace)
      const key = baseName.replace(/[-_]/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
      
      if (!groups[key]) {
        groups[key] = {
          id: p.id,
          name: baseName,
          category: p.category,
          image: p.image, // First image as cover
          images: []
        };
      }
      if (!groups[key].images.includes(p.image)) {
        groups[key].images.push(p.image);
      }
    });
    return Object.values(groups);
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
  const categoryCovers = useMemo(() => {
    return categoryCoversData;
  }, []);

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
    return groupedProducts.filter(product => {
      const matchesCategory = selectedCategory ? product.category === selectedCategory : true;
      const matchesSearch = searchQuery
        ? product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          product.category.toLowerCase().includes(searchQuery.toLowerCase())
        : true;
      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, searchQuery, groupedProducts]);

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
    setIsCategoryHovered(true);
  };


  // Check if we are searching (searching forces grid view of products across all categories)
  const isSearching = searchQuery.length > 0;

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
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
              className={`admin-toggle-btn ${isAdminMode ? 'active' : ''}`}
              onClick={() => {
                setIsAdminMode(!isAdminMode);
                setSelectedCategory(null);
                setSearchQuery('');
              }}
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
                  <h2 className="admin-title">Painel de Integração</h2>
                  <p className="admin-subtitle">Sincronização direta com o Google Drive.</p>
                </div>
              </div>

              <div className="admin-card form-section" style={{ textAlign: 'center', padding: '3.5rem 2rem' }}>
                <div style={{ color: 'var(--accent-gold)', marginBottom: '1.5rem' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill="currentColor" viewBox="0 0 16 16" style={{ margin: '0 auto' }}>
                    <path d="M12.5 13H3.928a1 1 0 0 1-.857-.485L.234 7.643a1 1 0 0 1 0-.986L2.943 1.83a1 1 0 0 1 .857-.484H12.5a1 1 0 0 1 .857.485l2.709 4.829a1 1 0 0 1 0 .986l-2.709 4.83a1 1 0 0 1-.857.484zM3.928 2.343L1.514 6.643l2.414 4.3H12.5l2.414-4.3-2.414-4.3H3.928z"/>
                  </svg>
                </div>
                <h3 className="card-title" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: '1.2rem', fontSize: '1.4rem' }}>
                  Catálogo no Google Drive
                </h3>
                <p style={{ color: 'var(--text-primary)', fontSize: '0.92rem', lineHeight: '1.6', marginBottom: '2.2rem', maxWidth: '480px', margin: '0 auto 2.2rem' }}>
                  Este catálogo está integrado diretamente com a sua pasta do Google Drive. 
                  Para adicionar novas fotos, criar categorias ou remover móveis, basta gerenciar os arquivos diretamente na sua pasta do Drive. As alterações serão refletidas automaticamente no site.
                </p>
                <a 
                  href="https://drive.google.com/drive/u/0/folders/1hnCfnQ9mNqFKzlyOLSbxnMGd-sKsYpdY" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="admin-submit-btn" 
                  style={{ display: 'inline-flex', textDecoration: 'none', justifyContent: 'center', maxWidth: '300px', margin: '0 auto' }}
                >
                  <Settings size={18} style={{ marginRight: '0.5rem' }} />
                  <span>Abrir Pasta do Google Drive</span>
                </a>
              </div>
            </div>
          ) : (
            <>
              {selectedCategory === null && !isSearching && (
                <h2 className="categories-landing-title">Categorias</h2>
              )}

          {/* Categories Carousel / Slider */}
          <div 
            className={`categories-carousel-container ${isCategoryHovered ? 'expanded' : 'minimized'}`}
            onMouseEnter={() => setIsCategoryHovered(true)}
            onMouseLeave={() => setIsCategoryHovered(false)}
            onTouchStart={(e) => { e.stopPropagation(); setIsCategoryHovered(true); }}
            onTouchEnd={(e) => { e.stopPropagation(); setIsCategoryHovered(false); }}
          >
            <button className="carousel-arrow left" onClick={() => handleScroll('left')}>
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
                  className={`category-card ${selectedCategory === cat ? 'selected' : ''}`}
                  onClick={(e) => {
                    if (dragDistance.current > 8) return; // Ignores drag
                    setSelectedCategory(cat);
                    setSearchQuery('');
                    setVisibleCount(24);
                    setIsCategoryHovered(false); // Minimiza imediatamente ao selecionar
                    e.stopPropagation(); // Evita expandir novamente pelo clique no container
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

            <button className="carousel-arrow right" onClick={() => handleScroll('right')}>
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
                          <img src={product.image} alt={product.name} loading="lazy" />
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
