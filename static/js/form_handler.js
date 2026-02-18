/* static/js/form_handler.js */

document.addEventListener('DOMContentLoaded', function() {
    const forms = document.querySelectorAll('form');

    forms.forEach(form => {
        form.addEventListener('submit', function() {
            const submitBtn = form.querySelector('button[type="submit"]');

            if (submitBtn) {
                const originalText = submitBtn.innerText;

                // Add loading class and update text
                submitBtn.classList.add('loading');
                submitBtn.innerHTML = `
                    <span>Processing...</span>
                    <i class="fas fa-circle-notch fa-spin spinner"></i>
                `;
            }
        });
    });
});