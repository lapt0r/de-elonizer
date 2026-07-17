#!/usr/bin/env bash
set -e

XCODE="/Applications/Xcode.app"
PROJECT="LinkedIn De-Elonizer/LinkedIn De-Elonizer.xcodeproj"
SCHEME="LinkedIn De-Elonizer (macOS)"
XCODEBUILD="$XCODE/Contents/Developer/usr/bin/xcodebuild"

if [ ! -d "$XCODE" ]; then
  echo "error: Xcode not found at $XCODE. Install Xcode from the App Store."
  exit 1
fi

# Detect a code-signing identity (Apple Development or Mac Developer)
IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null \
  | grep -E '"Apple Development:|"Mac Developer:' \
  | head -1 \
  | sed 's/.*) "\(.*\)"/\1/')

if [ -z "$IDENTITY" ]; then
  echo ""
  echo "No Apple Developer certificate found."
  echo "Open the project in Xcode, sign in with your Apple ID, and hit Run instead:"
  echo "  open \"$PROJECT\""
  exit 1
fi

echo "Signing with: $IDENTITY"
echo ""

DERIVED=$(DEVELOPER_DIR="$XCODE/Contents/Developer" \
  "$XCODEBUILD" -project "$PROJECT" -scheme "$SCHEME" \
    -configuration Debug \
    CODE_SIGN_STYLE=Manual \
    "CODE_SIGN_IDENTITY=$IDENTITY" \
    -showBuildSettings 2>/dev/null \
  | grep ' BUILT_PRODUCTS_DIR' | awk '{print $3}')

DEVELOPER_DIR="$XCODE/Contents/Developer" \
  "$XCODEBUILD" \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration Debug \
    CODE_SIGN_STYLE=Manual \
    "CODE_SIGN_IDENTITY=$IDENTITY" \
    build 2>&1 | grep -E "^(.*error:|.*warning:|BUILD )" | grep -v "The command"

APP="$DERIVED/LinkedIn De-Elonizer.app"
APPEX="$APP/Contents/PlugIns/LinkedIn De-Elonizer Extension.appex"

echo ""
echo "Registering extension..."
pluginkit -a "$APPEX"
sleep 1

# Verify registration
if pluginkit -mAvvv -p com.apple.Safari.web-extension 2>/dev/null | grep -q "de-elonizer"; then
  echo "Extension registered successfully."
else
  echo "warning: Extension did not appear in pluginkit — try opening Xcode and running from there."
fi

echo ""
echo "Launching app..."
pkill -f "LinkedIn De-Elonizer" 2>/dev/null || true
sleep 0.5
open "$APP"

echo ""
echo "Next steps:"
echo "  1. Safari → Develop menu → Allow Unsigned Extensions"
echo "     (you must re-enable this each time Safari restarts)"
echo "  2. Safari → Settings → Extensions → enable LinkedIn De-Elonizer"
echo "  3. Grant access to linkedin.com when prompted"
