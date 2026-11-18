"""GameMarket: объёмные предметы витрины (18.11.2026, по образцу объёмных значков Playerok).
Глянцевый пластик, палитра C: синий #1453ff, золото монет, белая керамика, графит. Прозрачный фон.
Основа — генератор Байсли и Блика. Blender 5.x headless, Cycles на Metal.
Запуск: дизайн/3d/render.sh "coins gem key card shield chest account wrench grid star bolt chat plus user gamepad"
"""
# ruff: noqa  (runs inside Blender's Python)
import bpy, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
PAL, KIND, OUT = argv[0], argv[1], argv[2]
SIZE, SAMPLES = int(argv[3]), int(argv[4])
FONT = argv[5] if len(argv) > 5 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return (*[x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c], 1.0)


def mat(name, color, rough=0.48, coat=0.12, sheen=0.08):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    for k, v in (("Base Color", srgb(color)), ("Roughness", rough), ("Coat Weight", coat),
                 ("Coat Roughness", 0.2), ("Sheen Weight", sheen), ("Subsurface Weight", 0.06)):
        if k in b.inputs:
            b.inputs[k].default_value = v
    return m


def gloss(name, color, rough=0.28):
    """Глянцевый пластик: меньше шероховатости, сильнее лак — как объёмные значки в нише."""
    return mat(name, color, rough=rough, coat=0.6, sheen=0.04)


MAIN = gloss("Main", "#1F5BFF")
SOFT = gloss("Soft", "#BFD3FF")
MILK = gloss("Milk", "#F7F9FC", rough=0.34)
ACC = gloss("Acc", "#FFC24D")
GOLD = mat("Gold", "#FFB020", rough=0.22, coat=0.7, sheen=0.02)
GOLD2 = mat("Gold2", "#FFD36B", rough=0.2, coat=0.7, sheen=0.02)
GRAPH = gloss("Graph", "#232A36", rough=0.32)
WORLD = "#eef2ff"


def smooth(o):
    if o.type == "MESH":
        for p in o.data.polygons:
            p.use_smooth = True


def extrude_outline(name, pts, depth, bevel, m, loc=(0, 0, 0), rot=(0, 0, 0)):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "2D"
    cu.fill_mode = "BOTH"
    cu.extrude = depth
    cu.bevel_depth = bevel
    cu.bevel_resolution = 8
    cu.resolution_u = 24
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, (x, y) in zip(sp.points, pts):
        p.co = (x, y, 0, 1)
    sp.use_cyclic_u = True
    o = bpy.data.objects.new(name, cu)
    o.data.materials.append(m)
    o.location = loc
    o.rotation_euler = rot
    scene.collection.objects.link(o)
    return o


def rounded_poly(pts, r, n=8):
    out = []
    k = len(pts)
    for i in range(k):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % k])
        a, b = (p0 - p1).normalized(), (p2 - p1).normalized()
        ang = math.acos(max(-1, min(1, a.dot(b))))
        d = min(r / math.tan(ang / 2), (p0 - p1).length / 2.1, (p2 - p1).length / 2.1)
        s, e = p1 + a * d, p1 + b * d
        for j in range(n + 1):
            t = j / n
            q = (1 - t) ** 2 * s + 2 * (1 - t) * t * p1 + t ** 2 * e
            out.append((q.x, q.y))
    return out


def rbox(name, loc, dims, m, bevel, seg=12, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(m)
    b = o.modifiers.new("bev", "BEVEL")
    b.width, b.segments, b.limit_method = bevel, seg, "NONE"
    smooth(o)
    return o


def sphere(name, loc, rad, m, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=rad, location=loc)
    o = bpy.context.object
    o.name, o.scale = name, scale
    o.data.materials.append(m)
    smooth(o)
    return o


def cyl(name, loc, rad, depth, m, bevel=0.06, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=rad, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(m)
    b = o.modifiers.new("bev", "BEVEL")
    b.width, b.segments, b.limit_method = bevel, 10, "ANGLE"
    smooth(o)
    return o


def glyph(name, ch, size, depth, bevel, m, loc, rot):
    bpy.ops.object.text_add(location=loc, rotation=rot)
    t = bpy.context.object
    t.name = name
    t.data.body = ch
    if FONT:
        t.data.font = bpy.data.fonts.load(FONT)
    t.data.size = size
    t.data.extrude = depth
    t.data.bevel_depth = bevel
    t.data.bevel_resolution = 6
    t.data.align_x = "CENTER"
    t.data.align_y = "CENTER"
    t.data.materials.append(m)
    return t


def tube(name, pts, thick, m, caps=True):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = thick
    cu.bevel_resolution = 10
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, (x, y, z) in zip(sp.points, pts):
        p.co = (x, y, z, 1)
    o = bpy.data.objects.new(name, cu)
    o.data.materials.append(m)
    scene.collection.objects.link(o)
    if caps:
        sphere(name + "A", pts[0], thick, m)
        sphere(name + "B", pts[-1], thick, m)
    return o


def group_rotate(rz=0.0, rx=0.0, ry=0.0):
    """Поворачивает всё собранное как одно целое через пустышку-родителя."""
    bpy.ops.object.empty_add(location=(0, 0, 0))
    e = bpy.context.object
    for o in list(scene.objects):
        if o is not e and o.type in ("MESH", "CURVE", "FONT"):
            o.parent = e
    e.rotation_euler = (rx, ry, rz)


cam_target = Vector((0, 0, 0))
cam_dist = 7.2
lift = 2.0


# ── GameMarket (18.11.2026): глянцевый пластик, как объёмные значки Playerok. Палитра C: синий #1453ff,
#    золото монет, белая керамика, графит. Предметы — для вкладок, кнопок шапки, баннеров и обложек лотов.
def coin(name, loc, rad, depth, rot=(0, 0, 0)):
    o = cyl(name, loc, rad, depth, GOLD, bevel=0.09, rot=rot)
    return o

if KIND == "coins":  # стопка золотых монет и одна прислонённая — валюта
    for i in range(4):
        coin(f"C{i}", (0.05 * (i % 2) - 0.02, 0, -0.75 + i * 0.3), 0.95, 0.26)
    cyl("Rim", (0, 0, 0.32), 0.66, 0.06, GOLD2, bevel=0.03)
    coin("Lean", (1.35, -0.45, -0.25), 0.8, 0.24, rot=(math.radians(80), 0, math.radians(-28)))
    cyl("Rim2", (1.35 + 0.13 * math.sin(math.radians(-28)), -0.45 - 0.13 * math.cos(math.radians(-28)), -0.25), 0.55, 0.05, GOLD2, bevel=0.03,
        rot=(math.radians(80), 0, math.radians(-28)))
    group_rotate(rz=math.radians(-10))
    cam_target, cam_dist, lift = Vector((0.4, 0, -0.1)), 7.0, 3.0
elif KIND == "gem":  # огранённый кристалл — донат
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=1.25, radius2=0.78, depth=0.55, location=(0, 0, 0.42))
    top = bpy.context.object; top.data.materials.append(MAIN)
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.0, radius2=1.25, depth=1.25, location=(0, 0, -0.48))
    bot = bpy.context.object; bot.data.materials.append(MAIN)
    for o in (top, bot):
        bv = o.modifiers.new("bev", "BEVEL"); bv.width, bv.segments, bv.limit_method = 0.03, 3, "ANGLE"
    rbox("Glint", (-0.35, -0.62, 0.55), (0.32, 0.04, 0.1), MILK, 0.03, rot=(0, 0, math.radians(-20)))
    group_rotate(rz=math.radians(14), rx=math.radians(10))
    cam_target, cam_dist, lift = Vector((0, 0, 0)), 7.4, 2.2
elif KIND == "key":  # ключ: золотое кольцо, стержень и бородка — ключи
    bpy.ops.mesh.primitive_torus_add(major_radius=0.62, minor_radius=0.22, location=(-1.1, 0, 0), rotation=(math.radians(90), 0, 0))
    ring = bpy.context.object; ring.data.materials.append(GOLD); smooth(ring)
    rbox("Shaft", (0.55, 0, 0), (2.2, 0.34, 0.34), GOLD, 0.12)
    rbox("T1", (1.25, 0, -0.32), (0.26, 0.3, 0.42), GOLD, 0.08)
    rbox("T2", (1.6, 0, -0.26), (0.24, 0.3, 0.3), GOLD, 0.08)
    sphere("Gem", (-1.1, -0.05, 0), 0.24, MAIN)
    group_rotate(rz=math.radians(-24), rx=math.radians(-18))
    cam_target, cam_dist, lift = Vector((0.2, 0, 0)), 7.4, 2.6
elif KIND == "card":  # подарочная карта пополнения: синяя, белая полоса, золотой чип
    rbox("Card", (0, 0, 0), (3.2, 2.0, 0.2), MAIN, 0.14)
    rbox("Chip", (-0.95, 0.3, 0.12), (0.6, 0.46, 0.08), GOLD, 0.06)
    rbox("L1", (0.15, -0.5, 0.12), (2.2, 0.16, 0.06), MILK, 0.05)
    rbox("L2", (-0.4, -0.78, 0.12), (1.1, 0.16, 0.06), SOFT, 0.05)
    cyl("Spot", (1.0, 0.45, 0.12), 0.36, 0.08, MILK, bevel=0.04)
    group_rotate(rz=math.radians(-14), rx=math.radians(64))
    cam_target, cam_dist, lift = Vector((0, 0, 0)), 7.8, 2.0
elif KIND == "shield":  # щит с галочкой — гарантия сделки
    s = [(0.0, 1.55), (1.25, 1.12), (1.25, 0.1), (0.9, -0.75), (0.0, -1.45), (-0.9, -0.75), (-1.25, 0.1), (-1.25, 1.12)]
    extrude_outline("Shield", rounded_poly(s, 0.3), 0.34, 0.16, MAIN, rot=(math.radians(90), 0, 0))
    tube("Check", [(-0.55, -0.55, 0.05), (-0.12, -0.55, -0.4), (0.62, -0.55, 0.5)], 0.17, MILK)
    group_rotate(rz=math.radians(-18), rx=math.radians(-4))
    cam_target, cam_dist, lift = Vector((0, 0, 0.05)), 8.0, 1.4
elif KIND == "chest":  # сундук: синий корпус, золотые полосы и замок — предметы
    rbox("Body", (0, 0, -0.35), (2.4, 1.5, 1.2), MAIN, 0.14)
    cyl("Lid", (0, 0, 0.25), 0.75, 2.4, MAIN, bevel=0.1, rot=(0, math.radians(90), 0))
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.32)); cut = bpy.context.object; cut.scale = (3, 3, 1.1)
    lid = bpy.data.objects["Lid"]; bm = lid.modifiers.new("cut", "BOOLEAN"); bm.object = cut; bm.operation = "DIFFERENCE"; cut.hide_render = True
    lid.scale = (1, 1, 1.0); lid.location.z = 0.24
    for x in (-0.8, 0.8):
        rbox(f"Band{x}", (x, 0, -0.05), (0.2, 1.56, 1.9), GOLD, 0.05)
    rbox("Lock", (0, -0.78, 0.18), (0.42, 0.14, 0.5), GOLD, 0.08)
    cyl("Hole", (0, -0.86, 0.14), 0.07, 0.06, GRAPH, bevel=0.01, rot=(math.radians(90), 0, 0))
    group_rotate(rz=math.radians(-28))
    cam_target, cam_dist, lift = Vector((0, 0, 0)), 8.6, 2.6
elif KIND == "account":  # карточка аккаунта: белая, синий кружок профиля без лица, строки — аккаунты
    rbox("Card", (0, 0, 0), (3.0, 2.0, 0.2), MILK, 0.16)
    cyl("Ava", (-0.85, 0.1, 0.13), 0.5, 0.1, MAIN, bevel=0.04)
    rbox("N1", (0.55, 0.32, 0.13), (1.35, 0.2, 0.06), MAIN, 0.05)
    rbox("N2", (0.35, -0.02, 0.13), (0.95, 0.16, 0.06), SOFT, 0.05)
    rbox("Badge", (0.75, -0.55, 0.13), (1.15, 0.3, 0.07), GOLD, 0.08)
    group_rotate(rz=math.radians(-12), rx=math.radians(64))
    cam_target, cam_dist, lift = Vector((0, 0, 0)), 7.6, 2.4
elif KIND == "wrench":  # гаечный ключ — услуги
    rbox("Handle", (0, 0, 0), (2.6, 0.56, 0.4), MAIN, 0.16)
    cyl("Head", (1.45, 0, 0), 0.7, 0.4, MAIN, bevel=0.1)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.34, depth=0.12, location=(1.45, 0, 0.17))
    hx = bpy.context.object; hx.data.materials.append(GRAPH)
    bv = hx.modifiers.new("bev", "BEVEL"); bv.width, bv.segments = 0.03, 3
    cyl("End", (-1.35, 0, 0), 0.44, 0.4, MAIN, bevel=0.1)
    cyl("Bolt", (-1.35, 0, 0.17), 0.2, 0.12, GOLD, bevel=0.03)
    group_rotate(rz=math.radians(28), rx=math.radians(60))
    cam_target, cam_dist, lift = Vector((0, 0, 0)), 7.6, 2.4
elif KIND == "grid":  # четыре плитки — «Все»
    for i, (x, y, m) in enumerate(((-0.62, 0.62, MAIN), (0.62, 0.62, SOFT), (-0.62, -0.62, GOLD), (0.62, -0.62, MAIN))):
        rbox(f"T{i}", (x, y, 0), (1.05, 1.05, 0.36), m, 0.22)
    group_rotate(rz=math.radians(-16), rx=math.radians(56))
    cam_target, cam_dist, lift = Vector((0, 0, 0)), 7.4, 2.6
elif KIND == "star":  # золотая звезда — звёзды, рейтинг
    def star_pts(R=1.0, r=0.46):
        return [((R if i % 2 == 0 else r) * math.cos(math.pi / 2 + i * math.pi / 5), (R if i % 2 == 0 else r) * math.sin(math.pi / 2 + i * math.pi / 5)) for i in range(10)]
    extrude_outline("Star", rounded_poly(star_pts(1.35, 0.64), 0.18), 0.3, 0.18, GOLD, rot=(math.radians(76), math.radians(-12), math.radians(10)))
    cam_dist = 7.0
elif KIND == "bolt":  # молния — автовыдача
    tilt = (math.radians(74), math.radians(-10), math.radians(12))
    b = [(-0.25, 1.6), (0.95, 1.6), (0.3, 0.35), (1.05, 0.35), (-0.55, -1.7), (-0.05, -0.2), (-0.8, -0.2)]
    extrude_outline("Bolt", rounded_poly(b, 0.14), 0.3, 0.16, GOLD, rot=tilt)
    cam_dist = 7.4
elif KIND == "chat":  # облачко сообщения — чаты
    rbox("Bubble", (0, 0, 0.15), (2.6, 0.6, 1.8), MAIN, 0.5)
    tail = [(-0.7, -0.2), (-0.15, -0.2), (-0.85, -0.9)]
    extrude_outline("Tail", rounded_poly(tail, 0.08), 0.3, 0.12, MAIN, loc=(0, 0.15, -0.6), rot=(math.radians(90), 0, 0))
    for i, x in enumerate((-0.6, 0.0, 0.6)):
        sphere(f"D{i}", (x, -0.33, 0.15), 0.18, MILK, scale=(1, 0.5, 1))
    group_rotate(rz=math.radians(-18), rx=math.radians(-4))
    cam_target, cam_dist, lift = Vector((0, 0, 0)), 7.8, 1.6
elif KIND == "plus":  # плюс на синей плитке — продать
    rbox("Tile", (0, 0, 0), (2.3, 0.6, 2.3), MAIN, 0.5)
    rbox("H", (0, -0.36, 0), (1.25, 0.2, 0.34), MILK, 0.14)
    rbox("V", (0, -0.36, 0), (0.34, 0.2, 1.25), MILK, 0.14)
    group_rotate(rz=math.radians(-20), rx=math.radians(-6))
    cam_target, cam_dist, lift = Vector((0, 0, 0)), 7.6, 1.6
elif KIND == "user":  # профиль: кружок и плечи без лица — войти
    sphere("Head", (0, 0, 0.75), 0.62, MAIN)
    sphere("Body", (0, 0, -0.75), 1.1, SOFT, scale=(1, 0.7, 0.62))
    group_rotate(rz=math.radians(-16))
    cam_target, cam_dist, lift = Vector((0, 0, 0)), 7.6, 1.6
elif KIND == "crown":  # корона: золотой обод, пять зубцов с шариками, синие камни — подписки и премиум
    cyl("Band", (0, 0, -0.55), 1.25, 0.55, GOLD, bevel=0.1)
    for i in range(5):
        a = math.radians(90 + i * 72)
        x, y = 1.05 * math.cos(a), 1.05 * math.sin(a)
        bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=0.36, radius2=0.06, depth=1.25, location=(x, y, 0.28))
        c = bpy.context.object; c.scale = (1, 1, 1); c.data.materials.append(GOLD); smooth(c)
        sphere(f"Tip{i}", (x * 1.0, y * 1.0, 0.86), 0.16, GOLD2)
    for i, a in enumerate((-90, -18, 54, 126, 198)):
        r = math.radians(a)
        sphere(f"Gem{i}", (1.27 * math.cos(r), 1.27 * math.sin(r), -0.55), 0.17, MAIN, scale=(1, 1, 1.2))
    group_rotate(rz=math.radians(-12), rx=math.radians(-4))
    cam_target, cam_dist, lift = Vector((0, 0, 0.1)), 8.6, 1.1
elif KIND == "logo":  # знак GameMarket в нашем стиле: графитовая глянцевая плитка, белый геймпад, синие кнопки
    rbox("Tile", (0, 0, 0), (2.7, 0.8, 2.7), GRAPH, 0.62)
    rbox("Pad", (0, -0.5, 0.06), (1.78, 0.34, 0.82), MILK, 0.38)
    for s_ in (-1, 1):
        sphere(f"G{s_}", (0.64 * s_, -0.5, -0.27), 0.38, MILK, scale=(0.9, 0.6, 1.08))
    rbox("DpH", (-0.43, -0.69, 0.07), (0.38, 0.08, 0.12), GRAPH, 0.035)
    rbox("DpV", (-0.43, -0.69, 0.07), (0.12, 0.08, 0.38), GRAPH, 0.035)
    for i, (x, z) in enumerate(((0.4, 0.22), (0.57, 0.06), (0.4, -0.1), (0.23, 0.06))):
        sphere(f"B{i}", (x, -0.69, z), 0.08, MAIN if i % 2 == 0 else SOFT, scale=(1, 0.5, 1))
    group_rotate(rz=math.radians(-16), rx=math.radians(-6))
    cam_target, cam_dist, lift = Vector((0, 0, 0)), 7.8, 1.3
elif KIND == "padwhite":  # белый геймпад знака анфас — для значков приложения (кладётся на графитовую плитку)
    rbox("Pad", (0, 0, 0.06), (1.78, 0.34, 0.82), MILK, 0.38)
    for s_ in (-1, 1):
        sphere(f"G{s_}", (0.64 * s_, 0, -0.27), 0.38, MILK, scale=(0.9, 0.6, 1.08))
    rbox("DpH", (-0.43, -0.19, 0.07), (0.38, 0.08, 0.12), GRAPH, 0.035)
    rbox("DpV", (-0.43, -0.19, 0.07), (0.12, 0.08, 0.38), GRAPH, 0.035)
    for i, (x, z) in enumerate(((0.4, 0.22), (0.57, 0.06), (0.4, -0.1), (0.23, 0.06))):
        sphere(f"B{i}", (x, -0.19, z), 0.08, MAIN if i % 2 == 0 else SOFT, scale=(1, 0.5, 1))
    group_rotate(rz=math.radians(-6), rx=math.radians(-4))
    cam_target, cam_dist, lift = Vector((0, 0, 0)), 7.0, 0.9
elif KIND == "gamepad":  # геймпад: графит, синие кнопки, золотая крестовина
    rbox("Body", (0, 0, 0), (3.2, 1.2, 1.5), GRAPH, 0.5)
    for s_ in (-1, 1):
        sphere(f"Grip{s_}", (1.15 * s_, 0, -0.55), 0.62, GRAPH, scale=(0.9, 0.8, 1.05))
    rbox("DpH", (-0.85, -0.6, 0.12), (0.62, 0.12, 0.2), GOLD, 0.06)
    rbox("DpV", (-0.85, -0.6, 0.12), (0.2, 0.12, 0.62), GOLD, 0.06)
    for i, (x, z) in enumerate(((0.75, 0.3), (1.05, 0.05), (0.75, -0.2), (0.45, 0.05))):
        sphere(f"B{i}", (x, -0.6, z), 0.13, MAIN if i % 2 else SOFT, scale=(1, 0.5, 1))
    group_rotate(rz=math.radians(-16), rx=math.radians(-10))
    cam_target, cam_dist, lift = Vector((0, 0, -0.1)), 8.4, 2.0


def area(name, loc, power, size, color="#ffffff", shadow=True):
    bpy.ops.object.light_add(type="AREA", location=loc)
    l = bpy.context.object
    l.name = name
    l.data.energy, l.data.size = power, size
    l.data.color = srgb(color)[:3]
    l.data.use_shadow = shadow
    l.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


area("Key", (-4.2, -3.6, 5.8), 520, 6.0)
area("Rim", (3.2, 4.0, 3.8), 600, 3.2, shadow=False)
area("Fill", (4.0, -4.0, 1.4), 170, 5.0, WORLD, shadow=False)
world = bpy.data.worlds.new("W")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = srgb(WORLD)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35

bpy.ops.object.camera_add(location=(cam_target.x + 0.9, cam_target.y - cam_dist, cam_target.z + lift))
cam = bpy.context.object
cam.data.lens = 70
cam.rotation_euler = (cam_target - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam

scene.render.engine = "CYCLES"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = "GPU"
except Exception as e:
    print("GPU off:", e)
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = SIZE
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "Standard"
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("WROTE", OUT)

