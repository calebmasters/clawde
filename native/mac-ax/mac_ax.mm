// clod_mac_ax — Node-API addon that adjusts the overlay's Accessibility identity.
//
// Tiling window managers (AeroSpace, yabai) discover windows through the
// Accessibility API and manage anything reporting AXSubrole "AXStandardWindow",
// which every Electron window does regardless of style mask (Electron's
// "panel" type is an NSWindow subclass, not a real NSPanel). Raycast/Spotlight
// panels report "AXSystemDialog" instead, which window managers classify as
// transient popups and leave alone. AppKit allows overriding the reported
// subrole per window; Electron exposes no API for it, hence this addon.
// See docs/AEROSPACE-OVERLAY-ISSUE.md for the full investigation.

#include <napi.h>

#import <AppKit/AppKit.h>

namespace {

// setWindowSubrole(handle, subrole) -> boolean
//   handle:  Buffer from BrowserWindow.getNativeWindowHandle() (an NSView*).
//   subrole: AX subrole to report, e.g. "AXSystemDialog".
// Returns true if the subrole was applied. Must be called on the main thread
// (Electron main-process JS always is).
Napi::Value SetWindowSubrole(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsString()) {
    Napi::TypeError::New(env, "setWindowSubrole(handle: Buffer, subrole: string)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Buffer<uint8_t> handle = info[0].As<Napi::Buffer<uint8_t>>();
  if (handle.Length() != sizeof(NSView*)) {
    Napi::TypeError::New(env, "unexpected native window handle size")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  NSView* view = *reinterpret_cast<NSView**>(handle.Data());
  NSWindow* window = [view window];
  if (window == nil) {
    return Napi::Boolean::New(env, false);
  }
  std::string subrole = info[1].As<Napi::String>().Utf8Value();
  [window setAccessibilitySubrole:[NSString stringWithUTF8String:subrole.c_str()]];
  return Napi::Boolean::New(env, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("setWindowSubrole", Napi::Function::New(env, SetWindowSubrole));
  return exports;
}

}  // namespace

NODE_API_MODULE(clod_mac_ax, Init)
