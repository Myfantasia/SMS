document.addEventListener('DOMContentLoaded', () => {
    const hiddenSelect = document.getElementById('hidden_subjects');
    const inputContainer = document.getElementById('multi_select_input');
    const chipsContainer = document.getElementById('chips_container');
    const dropdown = document.getElementById('multi_select_dropdown');

    if (!hiddenSelect) return;

    // Get the actual options from the hidden select
    const options = Array.from(hiddenSelect.options);

    function renderDropdown() {
        dropdown.innerHTML = '';
        options.forEach(option => {
            const div = document.createElement('div');
            div.className = `dropdown-option ${option.selected ? 'selected' : ''}`;
            div.textContent = option.text;

            // Toggle selection on click
            div.addEventListener('click', (e) => {
                e.stopPropagation();
                option.selected = !option.selected; // Updates the actual hidden select!
                renderChips();
                renderDropdown();
            });
            dropdown.appendChild(div);
        });
    }

    function renderChips() {
        const selectedOptions = options.filter(opt => opt.selected);

        if (selectedOptions.length === 0) {
            chipsContainer.innerHTML = '<span class="placeholder-text">Select one or more subjects...</span>';
            return;
        }

        chipsContainer.innerHTML = '';
        selectedOptions.forEach(opt => {
            const chip = document.createElement('div');
            chip.className = 'subject-chip';
            chip.innerHTML = `${opt.text} <i class="fas fa-times" data-value="${opt.value}"></i>`;
            chipsContainer.appendChild(chip);
        });

        // Handle removing a subject by clicking the 'x'
        chipsContainer.querySelectorAll('.fa-times').forEach(icon => {
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                const val = e.target.dataset.value;
                const optionToDeselect = options.find(o => o.value === val);
                if (optionToDeselect) optionToDeselect.selected = false;
                renderChips();
                renderDropdown();
            });
        });
    }

    // Toggle dropdown visibility
    inputContainer.addEventListener('click', () => {
        dropdown.classList.toggle('show');
        inputContainer.classList.toggle('active');
    });

    // Close dropdown when clicking anywhere else on the page
    document.addEventListener('click', (e) => {
        if (!inputContainer.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.remove('show');
            inputContainer.classList.remove('active');
        }
    });

    // Initial render
    renderDropdown();
    renderChips();
});