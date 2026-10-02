import { tlsForUrl } from '../tls';

describe('tlsForUrl', () => {
  it('turns TLS on for an https URL, with the system trust store', () => {
    expect(tlsForUrl('https://grpc.example.test:443')).toEqual({});
    expect(tlsForUrl('HTTPS://grpc.example.test')).toEqual({});
    expect(tlsForUrl('  https://grpc.example.test  ')).toEqual({});
  });

  it('leaves a plain http URL in plaintext, as before', () => {
    expect(tlsForUrl('http://localhost:50051')).toBeUndefined();
    expect(tlsForUrl('http://orchestrator:50051')).toBeUndefined();
  });

  it('never overrides an explicit setting', () => {
    const custom = { caPath: '/etc/orcher/ca.pem' };
    expect(tlsForUrl('https://grpc.example.test', custom)).toBe(custom);
    // Explicit TLS on a plain URL is the caller's decision too.
    expect(tlsForUrl('http://grpc.example.test', custom)).toBe(custom);
  });
});
