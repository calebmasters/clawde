#!/bin/bash
# Create a self-signed code-signing identity for Clod.
#
# Why: the app is ad-hoc signed, so every rebuild changes its code hash and macOS
# invalidates the Accessibility (TCC) grant that the uiohook key hook needs.
# A stable signing certificate keeps the app's designated requirement constant
# across rebuilds, so the grant survives.
set -euo pipefail

CN="Clod Code Signing"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if security find-identity -v -p codesigning | grep -q "$CN"; then
  echo "Identity \"$CN\" already exists — nothing to do."
  exit 0
fi

cat > "$WORK/cert.cnf" <<'EOF'
[ req ]
distinguished_name = dn
x509_extensions    = v3
prompt             = no
[ dn ]
CN = Clod Code Signing
[ v3 ]
basicConstraints     = critical,CA:false
keyUsage             = critical,digitalSignature
extendedKeyUsage     = critical,codeSigning
EOF

echo "Generating key + self-signed certificate (10 year validity)..."
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$WORK/key.pem" -out "$WORK/cert.pem" -config "$WORK/cert.cnf" 2>/dev/null

# macOS `security` cannot read OpenSSL 3's default PKCS#12 encryption, and empty
# passwords fail MAC verification — use legacy PBE with a throwaway password.
P12PASS="clod-temp"
openssl pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" \
  -out "$WORK/cert.p12" -passout "pass:$P12PASS" \
  -macalg sha1 -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES

echo "Importing into the login keychain..."
security import "$WORK/cert.p12" \
  -k "$HOME/Library/Keychains/login.keychain-db" \
  -P "$P12PASS" -A -T /usr/bin/codesign -T /usr/bin/security

# electron-builder discovers identities with `security find-identity -v`, which
# hides untrusted certificates — so the cert must be trusted for code signing.
echo "Trusting the certificate for code signing..."
security find-certificate -c "$CN" -p "$HOME/Library/Keychains/login.keychain-db" > "$WORK/cert-out.pem"
security add-trusted-cert -r trustRoot -p codeSign "$WORK/cert-out.pem"

echo
echo "Result:"
security find-identity -v -p codesigning

cat <<'NOTE'

Done. package.json already points mac.identity at "Clod Code Signing".

Rebuild with: bash commands/install-app.command

You will need to grant Accessibility to Clod once more after the first signed
build (the identity changed). After that the grant survives future rebuilds.
NOTE
