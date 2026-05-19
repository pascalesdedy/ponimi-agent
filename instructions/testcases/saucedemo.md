## Target Application
- **BASE_URL**: https://www.saucedemo.com
- **Application Type**: E-commerce demo site (Sauce Labs)
- **Known Credentials**:
  - Standard user: `standard_user` / `secret_sauce`
  - Locked out user: `locked_out_user` / `secret_sauce`
  - Problem user: `problem_user` / `secret_sauce`
  - Performance glitch user: `performance_glitch_user` / `secret_sauce`

## Key Pages/Selectors
- Login page: `/` (root)
  - Username field: `#user-name` or `[data-test="username"]`
  - Password field: `#password` or `[data-test="password"]`
  - Login button: `#login-button` or `[data-test="login-button"]`
  - Error message: `[data-test="error"]`
- Inventory page: `/inventory.html`
  - Product items: `[data-test="inventory-item"]`
  - Add to cart buttons: `[data-test^="add-to-cart"]`
  - Cart icon: `[data-test="shopping-cart-link"]`
- Cart page: `/cart.html`
  - Checkout button: `[data-test="checkout"]`
- Checkout pages: `/checkout-step-one.html`, `/checkout-step-two.html`

## Test Focus
Create login page tests covering:
1. Successful login with valid credentials
2. Failed login with invalid password
3. Failed login with locked_out_user
4. Empty username/password validation
5. UI element visibility on login page
