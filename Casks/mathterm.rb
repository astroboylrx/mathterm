cask "mathterm" do
  version "0.9.10"
  sha256 :no_check

  url "https://github.com/astroboylrx/mathterm/archive/refs/tags/v#{version}.tar.gz",
      verified: "github.com/astroboylrx/mathterm/"
  name "MathTerm"
  desc "Electron terminal with math-aware rich rendering"
  homepage "https://github.com/astroboylrx/mathterm"

  depends_on formula: "node"

  preflight do
    system_command "/bin/bash",
                   args: ["-lc", "npm ci && npm run dist:mac:dir"],
                   env: {
                     "CSC_IDENTITY_AUTO_DISCOVERY" => "false",
                     "HOME" => staged_path.join(".home").to_s,
                   }
  end

  postflight do
    # Manually clean up the heavy build folders inside the Caskroom
    system_command "/bin/bash",
                   args:["-c", "rm -rf '#{staged_path}/node_modules' '#{staged_path}/dist-electron'"]
  end

  on_arm do
    app "dist-electron/mac-arm64/MathTerm.app"
  end

  on_intel do
    app "dist-electron/mac/MathTerm.app"
  end

  zap trash: [
    "~/.config/mathterm",
    "~/Library/Application Support/MathTerm",
    "~/Library/Preferences/com.mathterm.app.plist",
    "~/Library/Saved Application State/com.mathterm.app.savedState",
  ]
end
