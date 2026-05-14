Output .github/demo.gif

Set Shell "bash"
Set FontSize 14
Set Width 800
Set Height 500
Set Theme {"name":"ruah","background":"#222221","foreground":"#f0eee9","cursor":"#00d2b9","black":"#111110","red":"#f07068","green":"#00d2b9","yellow":"#e5a84b","blue":"#7aa2f7","magenta":"#bb9af7","cyan":"#00bea8","white":"#f0eee9","brightBlack":"#565248","brightRed":"#f07068","brightGreen":"#00d2b9","brightYellow":"#e5a84b","brightBlue":"#7aa2f7","brightMagenta":"#bb9af7","brightCyan":"#00bea8","brightWhite":"#faf9f7","selectionBackground":"#2a2a28"}
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
