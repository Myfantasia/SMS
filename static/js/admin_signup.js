/* static/js/admin_signup.js */

// 1. YOUR FIREBASE CONFIG
const firebaseConfig = {
  apiKey: "AIzaSyD6NrpxBwBOIZIPTWd49x1sh3gvUuQzxPc",
  authDomain: "school-ms-8097f.firebaseapp.com",
  projectId: "school-ms-8097f",
  storageBucket: "school-ms-8097f.firebasestorage.app",
  messagingSenderId: "980169532643",
  appId: "1:980169532643:web:54644e338973b9368351d6",
  measurementId: "G-8JNXYN3KGK"
};

firebase.initializeApp(firebaseConfig);

const signupForm = document.getElementById('adminSignupForm');
const errorDiv = document.getElementById('errorMessage');
const signupBtn = document.querySelector('.btn-login');

if (signupForm) {
    signupForm.addEventListener('submit', (e) => {
        e.preventDefault();

        // UI Loading State
        signupBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Creating Account...';
        signupBtn.style.opacity = "0.7";
        errorDiv.style.display = "none";

        // 1. Gather all the data
        const email = document.getElementById('email').value;
        const pass1 = document.getElementById('pass1').value;
        const pass2 = document.getElementById('pass2').value;

        const firstName = document.getElementById('first_name').value;
        const lastName = document.getElementById('last_name').value;
        const address = document.getElementById('address').value;

        // Combine Country Code and Number
        const countryCode = document.getElementById('country_code')?.value || '+254';
        const mobileNum = document.getElementById('mobile').value;
        const fullMobile = countryCode + " " + mobileNum;

        const inviteCode = document.getElementById('invite_code').value;

        // 2. Client-side Validation
        if (pass1 !== pass2) {
            showError("Passwords do not match!");
            resetBtn();
            return;
        }

        if (pass1.length < 6) {
            showError("Password must be at least 6 characters.");
            resetBtn();
            return;
        }

        // 3. Create User in Firebase
        firebase.auth().createUserWithEmailAndPassword(email, pass1)
            .then((userCredential) => {
                return userCredential.user.getIdToken();
            })
            .then((token) => {
                // 4. Send EVERYTHING to Django
                return fetch('/api/firebase-admin-signup/', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        id_token: token,
                        first_name: firstName,
                        last_name: lastName,
                        address: address,
                        mobile: fullMobile,
                        invite_code: inviteCode
                    })
                });
            })
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    if (data.pending) {
                        alert(data.message || "Registration submitted! An existing administrator must approve your account before you can log in.");
                    }
                    window.location.href = "/adminlogin?status=registered";
                } else {
                    throw new Error(data.message || "Database syncing failed.");
                }
            })
            .catch((error) => {
                showError(error.message);
                resetBtn();
            });
    });
}

function showError(msg) {
    errorDiv.innerText = msg;
    errorDiv.style.display = "block";
}

function resetBtn() {
    signupBtn.innerHTML = 'Register Admin';
    signupBtn.style.opacity = "1";
}