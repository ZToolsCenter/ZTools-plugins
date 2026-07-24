import sys, ast

with open(sys.argv[1], 'r', encoding='utf-8') as f:
    src = f.read()

tree = ast.parse(src, filename=sys.argv[1])
ns = {'__name__': '__main__', '__file__': sys.argv[1]}

if tree.body and isinstance(tree.body[-1], ast.Expr):
    last = tree.body.pop()
    exec(compile(tree, sys.argv[1], 'exec'), ns)
    ast.fix_missing_locations(last)
    result = eval(compile(ast.Expression(body=last.value), sys.argv[1], 'eval'), ns)
    if result is not None:
        print(repr(result))
else:
    exec(compile(tree, sys.argv[1], 'exec'), ns)
