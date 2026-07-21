XCODE     := /Applications/Xcode.app
XCBUILD   := $(XCODE)/Contents/Developer/usr/bin/xcodebuild
CONVERTER := $(XCODE)/Contents/Developer/usr/bin/safari-web-extension-converter

APP_NAME  := LinkedIn De-Elonizer
SCHEME    := $(APP_NAME) (macOS)
BUILD_DIR := build
PROJECT   := $(BUILD_DIR)/$(APP_NAME)/$(APP_NAME).xcodeproj

IDENTITY  := $(shell security find-identity -v -p codesigning 2>/dev/null \
               | grep -E 'Apple Development:|Mac Developer:' \
               | head -1 | awk -F'"' '{print $$2}')

XCFLAGS   := -project "$(PROJECT)" \
              -scheme "$(SCHEME)" \
              -configuration Debug \
              CODE_SIGN_STYLE=Manual \
              "CODE_SIGN_IDENTITY=$(IDENTITY)"

.PHONY: all install build convert clean

all: install

$(PROJECT):
	@[ -x "$(CONVERTER)" ] || \
	  { echo "error: Xcode not found at $(XCODE). Install from the App Store."; exit 1; }
	@[ -n "$(IDENTITY)" ] || \
	  { echo "error: No Apple Developer certificate found."; \
	    echo "Open Xcode → Settings → Accounts, sign in, then re-run make."; \
	    exit 1; }
	@echo "→ Generating Safari extension project..."
	@"$(CONVERTER)" extension \
	  --project-location "$(BUILD_DIR)" \
	  --bundle-identifier com.de-elonizer \
	  --app-name "$(APP_NAME)" \
	  --macos-only \
	  --no-open 2>&1 | grep -v "^$$" || true

convert: $(PROJECT)

build: convert
	@echo "→ Building ($(IDENTITY))..."
	@"$(XCBUILD)" $(XCFLAGS) build 2>&1 | grep -E "error:|BUILD " || true

install: build
	@DERIVED="$$("$(XCBUILD)" $(XCFLAGS) -showBuildSettings 2>/dev/null \
	    | grep ' BUILT_PRODUCTS_DIR' | awk '{print $$3}')" && \
	  APPEX="$$DERIVED/$(APP_NAME).app/Contents/PlugIns/$(APP_NAME) Extension.appex" && \
	  echo "→ Registering extension..." && \
	  pluginkit -a "$$APPEX" && \
	  sleep 1 && \
	  pkill -f "$(APP_NAME)" 2>/dev/null; \
	  sleep 0.5 && \
	  open "$$DERIVED/$(APP_NAME).app" && \
	  echo "" && \
	  echo "Done. Next:" && \
	  echo "  1. Safari → Develop → Allow Unsigned Extensions (re-enable after each Safari restart)" && \
	  echo "  2. Safari → Settings → Extensions → enable LinkedIn De-Elonizer" && \
	  echo "  3. Grant access to linkedin.com when prompted"

clean:
	rm -rf "$(BUILD_DIR)"
