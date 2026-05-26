/**
 * Alpha City — Shared Navigation Component
 * Injects a consistent navigation bar across all pages.
 *
 * Usage: Add <script src="/shared/nav.js" defer></script> to any page.
 * Optionally set data-ac-nav-active="swap" on the <script> tag to highlight the active page.
 */

/* global window, document */

(function () {
    'use strict';

    var NAV_LINKS = [
        { href: '/', label: 'Home', id: 'home' },
        { href: '/swap/', label: 'Swap', id: 'swap' },
        { href: '/staking/', label: 'Staking', id: 'staking' },
        { href: '/construct/', label: 'Construct', id: 'construct' },
        { href: '/launchpad/', label: 'Launchpad', id: 'launchpad' },
        { href: '/mint/', label: 'Mint', id: 'mint' },
        { href: '/airdrop/', label: 'Airdrop', id: 'airdrop' },
        { href: '/venture/', label: 'Venture', id: 'venture' },
        { href: '/analyze/', label: 'Analyze', id: 'analyze' },
        { href: '/districts/', label: 'Districts', id: 'districts' }
    ];

    function getActivePage() {
        // Check for data attribute on the script tag
        var scripts = document.querySelectorAll('script[src*="shared/nav.js"]');
        for (var i = 0; i < scripts.length; i++) {
            var active = scripts[i].getAttribute('data-ac-nav-active');
            if (active) return active;
        }
        // Auto-detect from pathname
        var path = window.location.pathname;
        for (var j = 0; j < NAV_LINKS.length; j++) {
            if (NAV_LINKS[j].href !== '/' && path.startsWith(NAV_LINKS[j].href)) {
                return NAV_LINKS[j].id;
            }
        }
        if (path === '/' || path === '/index.html') return 'home';
        return '';
    }

    function createNav() {
        var activePage = getActivePage();

        var nav = document.createElement('nav');
        nav.id = 'ac-shared-nav';
        nav.className = 'sticky top-0 z-50 border-b border-gray-800 bg-gray-900/80 backdrop-blur-md';
        nav.setAttribute('aria-label', 'Main navigation');

        var inner = document.createElement('div');
        inner.className = 'max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14';

        // Brand
        var brand = document.createElement('a');
        brand.href = '/';
        brand.className = 'text-white font-bold text-lg tracking-tight hover:text-blue-400 transition-colors';
        brand.textContent = 'Alpha City';
        brand.setAttribute('aria-label', 'Alpha City home');

        // Desktop links
        var desktopLinks = document.createElement('div');
        desktopLinks.className = 'hidden md:flex items-center gap-1';

        NAV_LINKS.forEach(function (link) {
            var a = document.createElement('a');
            a.href = link.href;
            a.textContent = link.label;
            a.className = 'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ';
            if (link.id === activePage) {
                a.className += 'bg-blue-500/20 text-blue-400';
                a.setAttribute('aria-current', 'page');
            } else {
                a.className += 'text-gray-400 hover:text-white hover:bg-gray-800';
            }
            desktopLinks.appendChild(a);
        });

        // Mobile hamburger
        var mobileBtn = document.createElement('button');
        mobileBtn.type = 'button';
        mobileBtn.className = 'md:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors';
        mobileBtn.setAttribute('aria-label', 'Toggle navigation menu');
        mobileBtn.setAttribute('aria-expanded', 'false');
        mobileBtn.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>';

        // Mobile menu
        var mobileMenu = document.createElement('div');
        mobileMenu.className = 'md:hidden hidden absolute top-14 left-0 right-0 bg-gray-900 border-b border-gray-800 shadow-xl z-50';
        mobileMenu.setAttribute('role', 'menu');

        var mobileMenuInner = document.createElement('div');
        mobileMenuInner.className = 'px-4 py-3 space-y-1';

        NAV_LINKS.forEach(function (link) {
            var a = document.createElement('a');
            a.href = link.href;
            a.textContent = link.label;
            a.setAttribute('role', 'menuitem');
            a.className = 'block px-3 py-2 rounded-lg text-sm font-medium transition-colors ';
            if (link.id === activePage) {
                a.className += 'bg-blue-500/20 text-blue-400';
                a.setAttribute('aria-current', 'page');
            } else {
                a.className += 'text-gray-400 hover:text-white hover:bg-gray-800';
            }
            mobileMenuInner.appendChild(a);
        });
        mobileMenu.appendChild(mobileMenuInner);

        mobileBtn.addEventListener('click', function () {
            var expanded = mobileMenu.classList.contains('hidden');
            mobileMenu.classList.toggle('hidden');
            mobileBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        });

        inner.appendChild(brand);
        inner.appendChild(desktopLinks);
        inner.appendChild(mobileBtn);
        nav.appendChild(inner);
        nav.appendChild(mobileMenu);

        return nav;
    }

    // Inject nav as the first child of body
    function injectNav() {
        if (document.getElementById('ac-shared-nav')) return;
        var nav = createNav();
        document.body.insertBefore(nav, document.body.firstChild);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectNav);
    } else {
        injectNav();
    }
})();
