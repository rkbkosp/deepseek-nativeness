package main

// productName is the user-visible product name: menu bar, window title, About
// panel, session title fallback and settings metadata all read it from here.
//
// Two identities deliberately keep their original values:
//   - the bundle identifier (cn.rkbkosp.native-dsh.remote) and the executable
//     name (native-dsh), so macOS keeps treating a rebuilt app as the same app;
//   - the on-disk client state directory (see preferencePath), so an existing
//     install keeps its stored server, selection and appearance preferences.
//
// Renaming either one is a migration, not a rename of the product.
const productName = "DeepSeek Nativeness"
