/* static/js/password_reset.js */

document.addEventListener("DOMContentLoaded", function() {

    // 1. Toggle Password Visibility
    // We attach this to the global window object or use event delegation
    const toggleIcons = document.querySelectorAll('.toggle-pass');

    toggleIcons.forEach(icon => {
        icon.addEventListener('click', function() {
            const inputId = this.getAttribute('data-target');
            const input = document.getElementById(inputId);

            if (input.type === "password") {
                input.type = "text";
                this.classList.remove('fa-eye');
                this.classList.add('fa-eye-slash');
            } else {
                input.type = "password";
                this.classList.remove('fa-eye-slash');
                this.classList.add('fa-eye');
            }
        });
    });

    // 2. Form Validation (Match Passwords)
    const resetForm = document.getElementById('resetForm');
    if (resetForm) {
        resetForm.addEventListener('submit', function(e) {
            const pass1 = document.getElementById('pass1').value;
            const pass2 = document.getElementById('pass2').value;
            const errorText = document.getElementById('matchError');
            const pass2Input = document.getElementById('pass2');

            if (pass1 !== pass2) {
                e.preventDefault(); // Stop submission
                errorText.style.display = 'block';
                pass2Input.style.borderColor = '#f87171'; // Red border
            } else {
                errorText.style.display = 'none';
                pass2Input.style.borderColor = '#334155'; // Reset border
            }
        });
    }
});