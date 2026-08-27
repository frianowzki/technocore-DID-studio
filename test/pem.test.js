import test from 'node:test';
import assert from 'node:assert/strict';
import { createDid } from '../src/crypto.js';
import { decryptIdentityPem } from '../src/pem.js';

const PUBLIC_TEST_SEED = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const EXPECTED_DID = 'did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd';
const ENCRYPTED_PEM = Buffer.from('LS0tLS1CRUdJTiBFTkNSWVBURUQgUFJJVkFURSBLRVktLS0tLQpNSUdqTUY4R0NTcUdTSWIzRFFFRkRUQlNNREVHQ1NxR1NJYjNEUUVGRERBa0JCRGFCdTZxb0FLVjZnUmxDNTdmClFWc3JBZ0lJQURBTUJnZ3Foa2lHOXcwQ0NRVUFNQjBHQ1dDR1NBRmxBd1FCS2dRUXhITGFzdlBYVGR6UjVvZ3cKV2tobmxnUkE5N3RBSSsyWVVBVzM0TVZGNUNCTVc2WUNodU5hbUYvS1JxMklUd0lVcWdSRXNwQkdQeVRvY1g5Vgp0aTJDQTlYS1pzNTgwdmJzN1FFdTZyU05zc3pHR2c9PQotLS0tLUVORCBFTkNSWVBURUQgUFJJVkFURSBLRVktLS0tLQo=', 'base64').toString('utf8');

test('decrypts the starter encrypted Ed25519 identity.pem entirely in Web Crypto', async () => {
  const seed = await decryptIdentityPem(ENCRYPTED_PEM, 'correct horse battery staple');
  assert.equal(seed, PUBLIC_TEST_SEED);
  assert.equal(await createDid(seed), EXPECTED_DID);
});

test('rejects a wrong PEM passphrase without exposing parser details', async () => {
  await assert.rejects(decryptIdentityPem(ENCRYPTED_PEM, 'wrong passphrase here'), /incorrect passphrase or unsupported identity\.pem/i);
});

test('rejects unencrypted and non-PEM identity input', async () => {
  await assert.rejects(decryptIdentityPem('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----', 'anything long enough'), /encrypted PKCS#8 identity\.pem/i);
  await assert.rejects(decryptIdentityPem('not a pem', 'anything long enough'), /encrypted PKCS#8 identity\.pem/i);
});
