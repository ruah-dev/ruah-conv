Output .github/demo.gif

Set Shell "bash"
Set FontSize 14
Set Width 1000
Set Height 650
Set Theme "Catppuccin Mocha"
Set Padding 20

Hide
Type "export PATH=/opt/homebrew/bin:$PATH"
Enter
Sleep 500ms
Type "cd /Users/petre/Projects/personal-projects/ruah-tools/ruah-conv"
Enter
Sleep 500ms
Type "alias ruah-conv='node dist/cli.js'"
Enter
Sleep 300ms
Type "clear"
Enter
Sleep 500ms
Show

Set TypingSpeed 40ms

# Inspect the petstore spec
Type "ruah-conv inspect test/fixtures/clean/petstore.yaml"
Sleep 300ms
Enter
Sleep 3s

# Validate
Type "ruah-conv validate test/fixtures/clean/petstore.yaml"
Sleep 300ms
Enter
Sleep 2s

# Generate MCP tool definitions
Type "ruah-conv generate test/fixtures/clean/petstore.yaml --json"
Sleep 300ms
Enter
Sleep 4s
