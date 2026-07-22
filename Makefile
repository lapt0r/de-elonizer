XCODE    := /Applications/Xcode.app
XCBUILD  := $(XCODE)/Contents/Developer/usr/bin/xcodebuild
PACKAGER := $(XCODE)/Contents/Developer/usr/bin/safari-web-extension-packager

APP_NAME    := LinkedIn De-Elonizer
# --macos-only produces a scheme named after the app (no platform suffix)
SCHEME      := $(APP_NAME)
BUNDLE_ID   := com.de-elonizer
BUILD_DIR   := build
# Sentinel avoids re-running the packager; xcodeproj path has spaces which
# break Make file targets.
STAMP       := $(BUILD_DIR)/.packaged
PROJECT     := $(BUILD_DIR)/$(APP_NAME)/$(APP_NAME).xcodeproj
PBXPROJ     := $(PROJECT)/project.pbxproj
# Pin derived data location so we know the output path without a second
# xcodebuild invocation.
DERIVED     := $(BUILD_DIR)/derived
APP         := $(DERIVED)/Build/Products/Debug/$(APP_NAME).app
APPEX       := $(APP)/Contents/PlugIns/$(APP_NAME) Extension.appex
BUILD_LOG   := $(BUILD_DIR)/build.log

IDENTITY := $(shell security find-identity -v -p codesigning 2>/dev/null \
              | grep -E 'Apple Development:|Mac Developer:' \
              | head -1 | awk -F'"' '{print $$2}')

XCFLAGS := -project "$(PROJECT)" \
            -scheme "$(SCHEME)" \
            -configuration Debug \
            -derivedDataPath "$(DERIVED)" \
            CODE_SIGN_STYLE=Manual \
            "CODE_SIGN_IDENTITY=$(IDENTITY)"

DIST_DIR := dist

.PHONY: all install build package check clean chrome firefox

all: install

check:
	@[ -x "$(PACKAGER)" ] || \
	  { echo "error: Xcode not found at $(XCODE). Install from the App Store."; exit 1; }
	@[ -n "$(IDENTITY)" ] || \
	  { echo "error: No Apple Developer certificate found."; \
	    echo "Open Xcode → Settings → Accounts, sign in with your Apple ID, then re-run make."; \
	    exit 1; }

$(STAMP):
	@echo "→ Packaging extension (runs once; 'make clean' to redo)..."
	@"$(PACKAGER)" extension \
	  --project-location "$(BUILD_DIR)" \
	  --bundle-identifier "$(BUNDLE_ID)" \
	  --app-name "$(APP_NAME)" \
	  --macos-only \
	  --no-open \
	  --no-prompt \
	  --force 2>&1 | grep -v "^$$" || true
	@# The packager derives the app bundle ID from the app name rather than
	@# --bundle-identifier, producing com.LinkedIn-De-Elonizer. Xcode rejects
	@# an extension (com.de-elonizer.Extension) not prefixed by its parent app
	@# ID. Patch the pbxproj to align both under $(BUNDLE_ID).
	@sed -i '' 's/com\.LinkedIn-De-Elonizer/$(BUNDLE_ID)/g' "$(PBXPROJ)"
	@touch "$(STAMP)"

package: $(STAMP)

build: check package
	@echo "→ Building..."
	@"$(XCBUILD)" $(XCFLAGS) build > "$(BUILD_LOG)" 2>&1; \
	  STATUS=$$?; \
	  grep -E "error:|BUILD " "$(BUILD_LOG)" || true; \
	  exit $$STATUS

install: build
	@[ -d "$(APPEX)" ] || \
	  { echo "error: build output not found at $(APPEX)"; exit 1; }
	@echo "→ Registering extension..."
	@pluginkit -a "$(APPEX)"
	@sleep 1
	@pkill -f "$(APP_NAME)" 2>/dev/null || true
	@sleep 0.5
	@open "$(APP)"
	@echo ""
	@echo "Done. Next:"
	@echo "  1. Safari → Develop → Allow Unsigned Extensions (re-enable after each Safari restart)"
	@echo "  2. Safari → Settings → Extensions → enable LinkedIn De-Elonizer"
	@echo "  3. Grant access to linkedin.com when prompted"

chrome:
	@mkdir -p "$(DIST_DIR)"
	@cd extension && zip -r "../$(DIST_DIR)/chrome.zip" . -x "config.local.json"
	@echo "→ Built $(DIST_DIR)/chrome.zip"

firefox:
	@mkdir -p "$(DIST_DIR)"
	@cd extension && zip -r "../$(DIST_DIR)/firefox.zip" . -x "config.local.json"
	@echo "→ Built $(DIST_DIR)/firefox.zip"

clean:
	rm -rf "$(BUILD_DIR)" "$(DIST_DIR)"
