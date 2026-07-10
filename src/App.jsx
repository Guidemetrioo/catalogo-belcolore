import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, X, MessageCircle, ChevronLeft, ChevronRight, Grid } from 'lucide-react';
import productsData from './data/products.json';
import categoryCoversData from './data/category_covers.json';

function App() {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [visibleCount, setVisibleCount] = useState(24);
  const [isCategoryHovered, setIsCategoryHovered] = useState(false);

  // Extract unique categories dynamically
  const categories = useMemo(() => {
    const cats = new Set(productsData.map(p => p.category));
    return Array.from(cats).sort();
  }, []);

  // Compute number of products in each category
  const categoryCounts = useMemo(() => {
    const counts = {};
    productsData.forEach(p => {
      counts[p.category] = (counts[p.category] || 0) + 1;
    });
    return counts;
  }, []);

  // Pre-selected background-free/studio cover images for each category
  const categoryCovers = useMemo(() => {
    return categoryCoversData;
  }, []);

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
    return productsData.filter(product => {
      const matchesCategory = selectedCategory ? product.category === selectedCategory : true;
      const matchesSearch = searchQuery
        ? product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          product.category.toLowerCase().includes(searchQuery.toLowerCase())
        : true;
      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, searchQuery]);

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
  };

  // Open WhatsApp with pre-filled product inquiry message
  const handleWhatsAppContact = (product) => {
    const phoneNumber = "5511999999999"; // Generic placeholder number
    const message = `Olá! Gostaria de consultar mais informações sobre o produto *${product.name}* (Categoria: *${product.category}*) do catálogo Bel Colore.`;
    const url = `https://api.whatsapp.com/send?phone=${phoneNumber}&text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
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
        </div>
      </header>

      {/* Main Layout */}
      <div className="main-layout">
        {/* Catalog Content Area */}
        <main className="catalog-content">
          {/* Header title for landing state */}
          {selectedCategory === null && !isSearching && (
            <h2 className="categories-landing-title">Categorias</h2>
          )}

          {/* Categories Carousel / Slider */}
          <div 
            className={`categories-carousel-container ${selectedCategory !== null || isSearching ? 'minimized' : ''} ${(!selectedCategory && !isSearching) || isCategoryHovered ? 'expanded' : ''}`}
            onMouseEnter={() => (selectedCategory !== null || isSearching) && setIsCategoryHovered(true)}
            onMouseLeave={() => (selectedCategory !== null || isSearching) && setIsCategoryHovered(false)}
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
                  onClick={() => {
                    if (dragDistance.current > 8) return; // Ignores drag
                    setSelectedCategory(cat);
                    setSearchQuery('');
                    setVisibleCount(24);
                    setIsCategoryHovered(false); // Minimiza imediatamente ao selecionar
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
                  <div className="product-grid">
                    {visibleProducts.map((product) => (
                      <div
                        key={product.id}
                        className="product-card"
                        onClick={() => setSelectedProduct(product)}
                      >
                        <div className="product-image-wrapper">
                          <img src={product.image} alt={product.name} loading="lazy" />
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
        </main>
      </div>

      {/* Modal - Large Image Lightbox Popup */}
      {selectedProduct && (
        <div className="modal-overlay" onClick={() => setSelectedProduct(null)}>
          <div className="modal-content lightbox-mode" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={() => setSelectedProduct(null)}>
              <X size={20} />
            </button>
            <img src={selectedProduct.image} alt={selectedProduct.name} className="lightbox-image" />
          </div>
        </div>
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
