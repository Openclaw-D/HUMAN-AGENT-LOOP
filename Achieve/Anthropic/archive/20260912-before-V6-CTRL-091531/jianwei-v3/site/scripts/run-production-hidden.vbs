Option Explicit

If WScript.Arguments.Count <> 5 Then
    WScript.Quit 64
End If

Dim shell, powershellPath, workerPath, npmPath, runtimeRoot, port, command
Set shell = CreateObject("WScript.Shell")

powershellPath = WScript.Arguments(0)
workerPath = WScript.Arguments(1)
npmPath = WScript.Arguments(2)
runtimeRoot = WScript.Arguments(3)
port = WScript.Arguments(4)

command = QuoteArgument(powershellPath) _
    & " -NoProfile -ExecutionPolicy Bypass -File " & QuoteArgument(workerPath) _
    & " -NpmPath " & QuoteArgument(npmPath) _
    & " -RuntimeRoot " & QuoteArgument(runtimeRoot) _
    & " -Port " & QuoteArgument(port)

shell.Run command, 0, False
WScript.Quit 0

Function QuoteArgument(value)
    QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
