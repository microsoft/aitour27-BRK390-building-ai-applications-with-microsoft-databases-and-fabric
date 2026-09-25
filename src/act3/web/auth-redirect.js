/* global msalRedirectBridge */
msalRedirectBridge.broadcastResponseToMainFrame().catch(() => {
  document.getElementById('auth-status').textContent = 'Sign-in could not finish. Return to the application and sign in again.';
});