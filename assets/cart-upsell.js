/**
 * cart-upsell.js
 * Avex — Senior Shopify Developer Test
 *
 * Recommended products rendered as <tr> same classes, same structure.
 *
 * Add to cart uses the Shopify Section Rendering API to re-render
 * the entire cart section in place — same mechanism Dawn uses
 * internally for quantity changes — so totals and count badge
 * update immediately without a page reload.
 */

(function () {
  'use strict';

  const ROOT_PROD  = '#cart-related-products';
  const TRACK_CART = '#cart-upsell-track';

  /* ── Utilities ──────────────────────────────── */

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  function formatMoney(cents) {
    if (window.Shopify?.formatMoney && window.Shopify?.moneyFormat) {
      return Shopify.formatMoney(cents, Shopify.moneyFormat);
    }
    return `$${(cents / 100).toFixed(2)}`;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* ── API ────────────────────────────────────── */

  async function fetchRecommendations(productId, limit = 10) {
    const url = `/recommendations/products.json?product_id=${productId}&limit=${limit}&intent=related`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Recommendations fetch failed: ${res.status}`);
    const data = await res.json();
    return data.products || [];
  }

  async function fetchCart() {
    const res = await fetch('/cart.js');
    if (!res.ok) throw new Error('Cart fetch failed');
    return res.json();
  }

  async function addToCart(variantId) {
    const res = await fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: variantId, quantity: 1 })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.description || 'Add to cart failed');
    }
    return res.json();
  }

  /**
   * Re-renders the cart section using Shopify's Section Rendering API.
   * Fetches the section HTML and swaps the updated fragments in place,
   * so cart items, totals, and the header count badge all update live —
   * the same way Dawn handles quantity stepper changes internally.
   */
  async function refreshCartSection() {
    const sectionId = document.querySelector('#main-cart-items')?.dataset.id;

    if (!sectionId) {
      document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
      return;
    }

    const res = await fetch(`${window.location.pathname}?section_id=${sectionId}`);
    if (!res.ok) return;

    const html = await res.text();
    const doc  = new DOMParser().parseFromString(html, 'text/html');

    // Swap cart item rows
    const incomingContents = doc.querySelector('.js-contents');
    const currentContents  = document.querySelector('.js-contents');
    if (incomingContents && currentContents) {
      currentContents.innerHTML = incomingContents.innerHTML;
    }

    // Swap totals footer
    ['#main-cart-footer', '.totals', '.cart__footer'].forEach(sel => {
      const inc = doc.querySelector(sel);
      const cur = document.querySelector(sel);
      if (inc && cur) cur.innerHTML = inc.innerHTML;
    });

    // Update header cart count badge
    doc.querySelectorAll('.cart-count-bubble').forEach((inc, i) => {
      const cur = document.querySelectorAll('.cart-count-bubble')[i];
      if (cur) cur.innerHTML = inc.innerHTML;
    });

    document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
  }

  /* ── Card template ──────────────────────────── */

  function cardHTML(product) {
    const variant   = product.variants[0];
    const price     = formatMoney(variant.price);
    const compareAt = variant.compare_at_price && variant.compare_at_price > variant.price
      ? formatMoney(variant.compare_at_price) : null;
    // Recommendations API: featured_image is a direct URL string;
    // images[] items are objects with .url (not .src)
    const img = product.featured_image || product.images[0]?.url || product.images[0]?.src || '';

    // Only show options when product has real variants (not just "Default Title")
    const hasRealOptions = !(product.variants.length === 1 && variant.title === 'Default Title');
    // product.options is an array of objects {name, position, values} — use .name
    const optionsHTML = hasRealOptions
      ? product.options.map((option, i) =>
          `<div class="product-option"><dt>${esc(option.name || option)}:</dt><dd>${esc(variant.options[i] || '')}</dd></div>`
        ).join('')
      : '';

    // Mirrors Dawn's discounted price markup
    const priceHTML = compareAt
      ? `<div class="cart-item__discounted-prices">
           <span class="visually-hidden">Regular price</span>
           <s class="cart-item__old-price product-option">${esc(compareAt)}</s>
           <span class="visually-hidden">Sale price</span>
           <strong class="cart-item__final-price product-option">${esc(price)}</strong>
         </div>`
      : `<div class="product-option">${esc(price)}</div>`;

    // Strip HTML tags from description, truncate to 120 chars
    const plainDesc = (product.body_html || '').replace(/<[^>]*>/g, '').trim();
    const descHTML  = plainDesc
      ? `<p class="product-option cart-upsell__desc">${esc(plainDesc.slice(0, 120))}${plainDesc.length > 120 ? '...' : ''}</p>`
      : '';

    return `
      <tr class="cart-item cart-upsell__item" data-product-id="${product.id}" data-variant-id="${variant.id}">
        <td class="cart-item__media">
          <a href="/products/${esc(product.handle)}" class="cart-item__link" aria-hidden="true" tabindex="-1"> </a>
          <div class="cart-item__image-container gradient global-media-settings">
            ${img ? `<img src="${esc(img)}" alt="${esc(product.title)}" class="cart-item__image" width="150" height="150" loading="lazy" decoding="async">` : ''}
          </div>
        </td>
        <td class="cart-item__details">
          ${product.vendor ? `<p class="caption-with-letter-spacing">${esc(product.vendor)}</p>` : ''}
          <a href="/products/${esc(product.handle)}" class="cart-item__name h4 break">${esc(product.title)}</a>
          ${priceHTML}
          ${optionsHTML ? `<dl>${optionsHTML}</dl>` : ''}
          ${descHTML}
        </td>
        <td class="cart-item__quantity">
          <div class="cart-item__quantity-wrapper">
            <button
              class="cart-upsell__add-btn button"
              data-variant-id="${variant.id}"
              aria-label="Add ${esc(product.title)} to cart"
              ${variant.available ? '' : 'disabled'}
            >${variant.available ? 'Add to cart' : 'Sold out'}</button>
          </div>
        </td>
      </tr>`;
  }

  function skeletonHTML() {
    return Array.from({ length: 3 }, () => `
      <tr class="cart-item cart-upsell__item--skeleton" aria-hidden="true">
        <td class="cart-item__media">
          <div class="cart-item__image-container">
            <div class="skeleton-box" style="width:150px;height:150px"></div>
          </div>
        </td>
        <td class="cart-item__details">
          <div class="skeleton-line skeleton-line--short" style="margin-bottom:8px"></div>
          <div class="skeleton-line" style="margin-bottom:6px"></div>
          <div class="skeleton-line skeleton-line--price"></div>
        </td>
        <td class="cart-item__quantity">
          <div class="skeleton-line" style="height:36px;border-radius:4px"></div>
        </td>
      </tr>`
    ).join('');
  }

  /* ── Controller ─────────────────────────────── */

  class CartUpsell {
    constructor(cartRoot) {
      this.root  = cartRoot;
      this.track = document.querySelector(TRACK_CART);

      this.productId      = parseInt(cartRoot.dataset.currentProduct, 10);
      this.cartProductIds = new Set(
        (cartRoot.dataset.cartProductIds || '').split(',').map(Number).filter(Boolean)
      );

      if (!this.track) return;
      this._init();
    }

    _init() {
      this._load();

      document.addEventListener('cart:refresh', debounce(() => this._onCartChange(), 400));
      document.addEventListener('cart:updated', debounce(() => this._onCartChange(), 400));

      this.track.addEventListener('click', e => {
        const btn = e.target.closest('.cart-upsell__add-btn');
        if (btn) this._handleAdd(btn);
      });
    }

    async _onCartChange() {
      try {
        const cart = await fetchCart();
        if (!cart.items?.length) { this.root.hidden = true; return; }

        this.cartProductIds = new Set(cart.items.map(i => i.product_id));
        const newFirstId = cart.items[0].product_id;

        if (newFirstId !== this.productId) {
          this.productId = newFirstId;
          await this._load();
        } else {
          this._filterExisting();
        }
      } catch (e) {
        console.error('[CartUpsell]', e);
      }
    }

    async _load() {
      if (!this.productId) return;
      this._showSkeletons();

      try {
        const products = await fetchRecommendations(this.productId, 12);
        const filtered = products.filter(p => !this.cartProductIds.has(p.id)).slice(0, 6);

        if (!filtered.length) { this.root.hidden = true; return; }

        this.root.hidden     = false;
        this.track.innerHTML = filtered.map(cardHTML).join('');

        this.track.querySelectorAll('.cart-upsell__item').forEach((row, i) => {
          row.style.animationDelay = `${i * 55}ms`;
        });
      } catch (e) {
        console.error('[CartUpsell] load error:', e);
        this.root.hidden = true;
      }
    }

    _filterExisting() {
      this.track.querySelectorAll('.cart-upsell__item').forEach(row => {
        if (this.cartProductIds.has(Number(row.dataset.productId))) {
          row.style.opacity    = '0';
          row.style.transition = 'opacity 0.2s ease';
          setTimeout(() => row.remove(), 220);
        }
      });
    }

    _showSkeletons() {
      this.track.innerHTML = skeletonHTML();
    }

    async _handleAdd(btn) {
      if (btn.disabled || btn.dataset.loading) return;
      const variantId = parseInt(btn.dataset.variantId, 10);

      btn.dataset.loading = '1';
      btn.disabled        = true;
      btn.textContent     = 'Adding...';

      try {
        await addToCart(variantId);

        btn.textContent = 'Added!';
        btn.classList.add('cart-upsell__add-btn--success');

        // Refresh cart section: items + totals + header count badge
        await refreshCartSection();

        setTimeout(() => {
          btn.textContent = 'Add to cart';
          btn.classList.remove('cart-upsell__add-btn--success');
          btn.disabled    = false;
          delete btn.dataset.loading;
        }, 2000);

      } catch (err) {
        console.error('[CartUpsell] add error:', err);
        btn.textContent = 'Error — retry';
        btn.disabled    = false;
        delete btn.dataset.loading;
        setTimeout(() => { btn.textContent = 'Add to cart'; }, 2500);
      }
    }
  }

  /* ── Boot ───────────────────────────────────── */

  function boot() {
    const root = document.querySelector(ROOT_PROD);
    if (root) new CartUpsell(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();