import { SELF } from 'cloudflare:test';

describe('admin authentication', () => {
  it('rejects an invalid password without setting a cookie', async () => {
    const response = await SELF.fetch('https://quickshare.test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' })
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('sets a signed secure session cookie for the admin', async () => {
    const response = await SELF.fetch('https://quickshare.test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' })
    });
    const cookie = response.headers.get('Set-Cookie');

    expect(response.status).toBe(200);
    expect(cookie).toContain('quickshare_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');

    const session = await SELF.fetch('https://quickshare.test/api/auth/me', {
      headers: { Cookie: cookie?.split(';')[0] || '' }
    });
    await expect(session.json()).resolves.toEqual({ success: true, authenticated: true });
  });

  it('rejects a tampered session and clears a valid session on logout', async () => {
    const login = await SELF.fetch('https://quickshare.test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' })
    });
    const cookie = login.headers.get('Set-Cookie')?.split(';')[0] || '';
    const [name, value] = cookie.split('=');
    const tampered = await SELF.fetch('https://quickshare.test/api/auth/me', {
      headers: { Cookie: `${name}=${value}tampered` }
    });
    await expect(tampered.json()).resolves.toEqual({ success: true, authenticated: false });

    const logout = await SELF.fetch('https://quickshare.test/api/auth/logout', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'https://quickshare.test'
      }
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('rejects cross-origin mutations', async () => {
    const response = await SELF.fetch('https://quickshare.test/api/auth/logout', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' }
    });

    expect(response.status).toBe(403);
  });
});
