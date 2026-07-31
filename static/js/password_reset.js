/* static/js/password_reset.js */

document.addEventListener("DOMContentLoaded", function() {

    // Toggle-icon behavior now lives in password_toggle.js (shared with every other
    // auth page) — this file loads it too, see password_reset_confirm.html.

    // 2. Password Strength Meter
    const pass1Input = document.getElementById('pass1');
    const strengthBar = document.getElementById('strengthBar');
    const strengthLabel = document.getElementById('strengthLabel');

    if (pass1Input && strengthBar && strengthLabel) {
        const levels = [
            { width: '0%', color: '#ef4444', label: 'At least 8 characters, and not all numbers' },
            { width: '25%', color: '#ef4444', label: 'Weak — add length or mix in numbers/symbols' },
            { width: '50%', color: '#f59e0b', label: 'Fair — getting there' },
            { width: '75%', color: '#84cc16', label: 'Good' },
            { width: '100%', color: '#22c55e', label: 'Strong' },
        ];

        pass1Input.addEventListener('input', function () {
            const value = pass1Input.value;
            let score = 0;

            if (value.length >= 8) score++;
            if (value.length >= 12) score++;
            if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
            if (/\d/.test(value)) score++;
            if (/[^A-Za-z0-9]/.test(value)) score++;
            if (value.length > 0 && /^\d+$/.test(value)) score = Math.min(score, 1); // all-digit passwords are rejected server-side

            const level = value.length === 0 ? levels[0] : levels[Math.min(score, 4)];
            strengthBar.style.width = level.width;
            strengthBar.style.background = level.color;
            strengthLabel.textContent = level.label;
        });
    }

    // 3. Form Validation (Match Passwords)
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