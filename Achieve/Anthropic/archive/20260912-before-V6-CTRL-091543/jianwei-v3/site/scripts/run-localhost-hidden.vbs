Option Explicit

If WScript.Arguments.Count <> 4 Then
    WScript.Quit 64
End If

Dim shell, powershellPath, workerPath, npmPath, runtimeRoot, command
Set shell = CreateObject("WScript.Shell")

powershellPath = WScript.Arguments(0)
workerPath = WScript.Arguments(1)
npmPath = WScript.Arguments(2)
runtimeRoot = WScript.Arguments(3)

command = QuoteArgument(powershellPath) _
    & " -NoProfile -ExecutionPolicy Bypass -File " & QuoteArgument(workerPath) _
    & " -NpmPath " & QuoteArgument(npmPath) _
    & " -RuntimeRoot " & QuoteArgument(runtimeRoot)

WScript.Quit shell.Run(command, 0, True)

Function QuoteArgument(value)
    QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
