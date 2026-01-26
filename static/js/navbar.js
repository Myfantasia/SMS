document.addEventListener('DOMContentLoaded', () => {
    const navbar = document.querySelector('.navbar-container');
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const navWrapper = document.getElementById('nav-links');
    const portalBtn = document.querySelector('.portal-trigger');
    const dropdown = document.querySelector('.dropdown-menu');
    const chevron = portalBtn.querySelector('i');

    // 1. Mobile Menu Toggle
    mobileBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent immediate closing
        navWrapper.classList.toggle('active');
        document.body.classList.toggle('no-scroll');

        const icon = mobileBtn.querySelector('i');
        icon.classList.toggle('fa-bars');
        icon.classList.toggle('fa-times');
    });

    // 2. Portal Toggle (Click logic for Mobile / Hover logic for Desktop)
    portalBtn.addEventListener('click', (e) => {
        if (window.innerWidth <= 992) {
            e.preventDefault();
            dropdown.classList.toggle('show');
            chevron.classList.toggle('rotate-icon');
        }
    });

    // 3. Click Outside to Close
    // This is what makes a site feel "expensive"
    document.addEventListener('click', (e) => {
        if (!navWrapper.contains(e.target) && !mobileBtn.contains(e.target)) {
            navWrapper.classList.remove('active');
            const icon = mobileBtn.querySelector('i');
            icon.classList.add('fa-bars');
            icon.classList.remove('fa-times');
            document.body.classList.remove('no-scroll');
        }

        if (!portalBtn.contains(e.target)) {
            dropdown.classList.remove('show');
            chevron.classList.remove('rotate-icon');
        }
    });

    // 4. Scroll Logic (Using a class is cleaner than inline styles)
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('navbar-scrolled');
            // Move height logic to CSS class .navbar-scrolled
        } else {
            navbar.classList.remove('navbar-scrolled');
        }
    });

    // 5. Active Link Highlighting (Portal parent support)
    const currentPath = window.location.pathname;
    document.querySelectorAll('.nav-item, .drop-item').forEach(link => {
        if (link.getAttribute('href') === currentPath) {
            link.classList.add('active-link');

            // If the active link is inside a portal, highlight the portal button too
            if (link.classList.contains('drop-item')) {
                portalBtn.style.background = 'rgba(255, 255, 255, 0.2)';
            }
        }
    });
});