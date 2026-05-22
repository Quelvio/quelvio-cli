import { describe, expect, it, vi } from 'vitest';
import {
  CLIENT_ID,
  DeviceFlowError,
  deviceAuthorize,
  pollToken,
  refreshToken,
  revokeToken,
} from '../src/auth/device-flow.js';

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('device-flow protocol', () => {
  it('deviceAuthorize posts client_id and parses handshake', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResp(200, {
        device_code: 'qlv_dvc_abc',
        user_code: 'BCDF-GHJK',
        verification_uri: 'https://enterprise.quelvio.com/device',
        verification_uri_complete: 'https://enterprise.quelvio.com/device?code=BCDF-GHJK',
        expires_in: 600,
        interval: 5,
      }),
    );
    const auth = await deviceAuthorize({
      baseUrl: 'https://api.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(auth.device_code).toBe('qlv_dvc_abc');
    expect(auth.user_code).toBe('BCDF-GHJK');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.test/oauth/device/authorize');
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers['Content-Type']).toBe('application/json');
    expect((init as { body: string }).body).toBe(JSON.stringify({ client_id: CLIENT_ID }));
  });

  it('deviceAuthorize throws DeviceFlowError on 401 invalid_client', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResp(401, { error: 'invalid_client', error_description: 'no' }));
    await expect(
      deviceAuthorize({
        baseUrl: 'https://api.test',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(DeviceFlowError);
  });

  it('pollToken returns success on 200 with access_token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResp(200, {
        access_token: 'qlv_oat_abc',
        refresh_token: 'qlv_ort_xyz',
        expires_in: 3600,
      }),
    );
    const result = await pollToken({
      baseUrl: 'https://api.test',
      deviceCode: 'qlv_dvc_abc',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.tokens.access_token).toBe('qlv_oat_abc');
      expect(result.tokens.refresh_token).toBe('qlv_ort_xyz');
    }
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.test/oauth/token');
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = String((init as { body: string }).body);
    expect(body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code');
    expect(body).toContain('device_code=qlv_dvc_abc');
    expect(body).toContain(`client_id=${CLIENT_ID}`);
  });

  it.each([
    ['authorization_pending', 'pending'],
    ['slow_down', 'slow_down'],
    ['expired_token', 'expired'],
    ['access_denied', 'denied'],
  ] as const)('pollToken maps %s → %s', async (errCode, expectedKind) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResp(400, { error: errCode }));
    const result = await pollToken({
      baseUrl: 'https://api.test',
      deviceCode: 'd',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.kind).toBe(expectedKind);
  });

  it('pollToken maps unknown oauth error to error kind', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResp(400, { error: 'invalid_grant', error_description: 'reused' }));
    const result = await pollToken({
      baseUrl: 'https://api.test',
      deviceCode: 'd',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.code).toBe('invalid_grant');
      expect(result.description).toBe('reused');
    }
  });

  it('refreshToken posts refresh_token and returns the rotated pair', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResp(200, {
        access_token: 'qlv_oat_new',
        refresh_token: 'qlv_ort_new',
        expires_in: 3600,
      }),
    );
    const fresh = await refreshToken({
      baseUrl: 'https://api.test',
      refreshToken: 'qlv_ort_old',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fresh.access_token).toBe('qlv_oat_new');
    expect(fresh.refresh_token).toBe('qlv_ort_new');
    const body = String((fetchImpl.mock.calls[0][1] as { body: string }).body);
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=qlv_ort_old');
  });

  it('refreshToken throws DeviceFlowError on invalid_grant', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResp(400, { error: 'invalid_grant' }));
    await expect(
      refreshToken({
        baseUrl: 'https://api.test',
        refreshToken: 'rt',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(DeviceFlowError);
  });

  it('revokeToken posts token + token_type_hint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResp(200, {}));
    await revokeToken({
      baseUrl: 'https://api.test',
      token: 'qlv_oat_x',
      tokenTypeHint: 'access_token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.test/oauth/revoke');
    const body = String((init as { body: string }).body);
    expect(body).toContain('token=qlv_oat_x');
    expect(body).toContain('token_type_hint=access_token');
  });
});
