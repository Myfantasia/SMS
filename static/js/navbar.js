document.addEventListener('DOMContentLoaded', () => {
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const navWrapper = document.getElementById('nav-links');

    const portalContainer = document.querySelector('.portal-dropdown');
    const dropdown = document.querySelector('.dropdown-menu');
    const portalBtn = document.querySelector('.portal-trigger');

    let closeTimer;

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

    if (portalBtn) {
        portalBtn.addEventListener('click', (e) => {
            if (window.innerWidth <= 992) {
                e.preventDefault();
                dropdown.classList.toggle('show');
            }
        });
    }

    document.querySelectorAll('.nav-item').forEach(link => {
        if (link.getAttribute('href') === window.location.pathname) {
            link.classList.add('active-link');
        }
    });
});