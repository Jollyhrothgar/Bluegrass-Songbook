# Email/Password Auth - Remaining Steps

## Production Supabase Settings

These changes were made in `supabase/config.toml` for local dev but must also be applied in the **production Supabase dashboard**:

1. Go to **Authentication > Settings > Email Auth**
2. Enable **Confirm email** (require email confirmation before first sign-in)
3. Set **Minimum password length** to `8`

Dashboard URL: https://supabase.com/dashboard/project/ofmqlrnyldlmvggihogt/auth/providers

## Email Templates (Optional)

The default Supabase email templates work fine, but you may want to customize:

- **Confirmation email** — sent on sign-up
- **Password reset email** — sent when user clicks "Forgot password?"

Go to **Authentication > Email Templates** in the Supabase dashboard.

## Testing Checklist

- [ ] Sign up with email → confirmation email arrives → click link → signed in
- [ ] Sign in with email/password → works, shows initials avatar
- [ ] Forgot password → reset email → click link → new password form → works
- [ ] Google OAuth still works (button is now inside the modal)
- [ ] Account linking: sign up with email, sign out, sign in with Google (same email) → same user
- [ ] "Sign In to Share" in lists opens auth modal (not direct Google)
- [ ] Roles work for email users (trusted_users, admin_users)
- [ ] Dark mode: all new UI elements look correct
- [ ] Mobile: modal scrolls, keyboard doesn't obscure inputs
