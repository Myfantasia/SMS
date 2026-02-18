document.addEventListener('DOMContentLoaded', () => {
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const navWrapper = document.getElementById('nav-links');
    const portalContainer = document.querySelector('.portal-dropdown');
    const dropdown = document.querySelector('.dropdown-menu');
    const portalBtn = document.querySelector('.portal-trigger');

    let closeTimer;

    // 1. PORTAL DROPDOWN LOGIC (Desktop Hover)
    if (portalContainer && dropdown) {
        portalContainer.addEventListener('mouseenter', () => {
            clearTimeout(closeTimer);
            dropdown.classList.add('show');
            if (portalBtn) {
                const icon = portalBtn.querySelector('i');
                if (icon) icon.classList.add('rotate-icon');
            }
        });

        portalContainer.addEventListener('mouseleave', () => {
            closeTimer = setTimeout(() => {
                dropdown.classList.remove('show');
                if (portalBtn) {
                    const icon = portalBtn.querySelector('i');
                    if (icon) icon.classList.remove('rotate-icon');
                }
            }, 500);
        });
    }

    // 2. MOBILE MENU TOGGLE
    if (mobileBtn) {
        mobileBtn.addEventListener('click', () => {
            navWrapper.classList.toggle('active');
            const icon = mobileBtn.querySelector('i');
            if (navWrapper.classList.contains('active')) {
                icon.classList.remove('fa-bars');
                icon.classList.add('fa-times');
                document.body.classList.add('no-scroll');
            } else {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
                document.body.classList.remove('no-scroll');
            }
        });
    }

    // 3. PORTAL CLICK (Mobile view)
    if (portalBtn) {
        portalBtn.addEventListener('click', (e) => {
            if (window.innerWidth <= 992) {
                e.preventDefault();
                dropdown.classList.toggle('show');
            }
        });
    }

    // 4. ACTIVE LINK DETECTION (Improved)
    const currentPath = window.location.pathname;

    // We target links with .nav-item and also links inside the dropdown
    const allLinks = document.querySelectorAll('.nav-item, .dropdown-item');

    allLinks.forEach(link => {
        const linkPath = link.getAttribute('href');

        // Reset any existing active classes
        link.classList.remove('active-link');

        if (linkPath === currentPath) {
            // Perfect match
            link.classList.add('active-link');
        } else if (linkPath !== '/' && currentPath.startsWith(linkPath)) {
            // Matches sub-pages (e.g., if link is /student and path is /studentlogin)
            link.classList.add('active-link');
        } else if (currentPath === '/' && linkPath === '/') {
            // Home page match
            link.classList.add('active-link');
        }
    });
});