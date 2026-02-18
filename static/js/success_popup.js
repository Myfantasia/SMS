/* static/js/success_popup.js */

function closeSuccessModal() {
    const modal = document.getElementById('successModal');
    if (modal) {
        // Add a fade-out effect
        modal.style.transition = "opacity 0.4s ease, transform 0.4s ease";
        modal.style.opacity = "0";
        modal.style.transform = "scale(0.95)";

        // Remove from DOM after animation finishes
        setTimeout(() => {
            modal.remove();
        }, 400);
    }
}

// Auto-close if the user is idle for 15 seconds
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('successModal');
    if (modal) {
        setTimeout(closeSuccessModal, 15000);
    }
});