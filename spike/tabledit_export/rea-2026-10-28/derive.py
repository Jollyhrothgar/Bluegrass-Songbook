"""Faithful port of TablEdit 3.06 arm64 FUN_1000355ec (createReadingListFromMarkers core).
Input: flags = list of u16 per measure (OR of byte2 of the 0xb7 cells that fall in the measure).
Output: list of (from,to) 1-based entries (stream out[0]=1, then (end,start) jump pairs, then final end).
"""


def derive(flags, trace=False):
    n = len(flags)
    M = [f | 0x4000 for f in flags] + [0] * 4  # sentinel(s)
    out = [1]
    CAP = 0x60

    def o():
        return len(out)

    def emit(a, b):
        out.extend([a, b])

    f = M[0]
    i8 = i9 = i13 = i12 = 0
    st = 0
    state = 'TOP' if f != 0 else 'FIN'
    guard = 0
    while True:
        guard += 1
        if guard > 100000:
            raise RuntimeError('loop')
        if state == 'TOP':
            i13 = i8
            if (f & 0x18) == 0x10:
                i9 = 0
                st = -1
                k = i8
                found = False
                while True:
                    i13 = i8
                    if k < 1:
                        break
                    j = k - 1
                    i13 = j
                    if M[j] & 0x1000:
                        i9 = j
                    k = j
                    if (~M[j] & 0x18) == 0 and not (o() > 0x5f):
                        found = True
                        break
                if found:
                    emit(i8 + 1, i13 + 1)
                    M[i13] &= 0xffe7
                    M[i8] &= 0xffef
                    st = 0x400
                if i9 != 0:
                    state = 'FIN'
                    continue
            i9 = i13
            i8 = i13
            f = M[i8]
            if (f & 0x28) == 0x20 and st == 0x400:
                u20 = i8 + 1
                st = u20
                u3 = M[u20]
                if u3 != 0:
                    c = 0
                    hit = False
                    while True:
                        if (~u3 & 0x28) == 0 and o() < CAP:
                            i9 = i8 + c + 1
                            emit(u20, u20 + c + 1)
                            i8 = u20 + c
                            f = M[i8]
                            st = i9
                            hit = True
                            break
                        c += 1
                        u3 = M[u20 + c]
                        if u3 == 0:
                            break
                    if hit:
                        state = 'L7A4' if (f >> 6) & 1 else 'L8BC'
                        continue
                    st = i8 + c + 1
            state = 'L7A4' if (f >> 6) & 1 else 'L8BC'
            continue
        if state == 'L7A4':
            sv = i9 + 1
            while True:
                i9 = i8
                if (f & 7) == 1:
                    f = M[i8 + 1]
                    if f != 0:
                        idx = i8 + 1
                        pc = 0
                        i13 = i8
                        i12 = i8 + 1
                        while True:
                            u17 = f
                            if (f & 7) != 0 and o() < CAP:
                                d = (f & 7) - pc
                                if d > 1:
                                    for _ in range(d - 1):
                                        emit(idx, sv)
                                    pc = (f & 7) - 1
                                emit(i8, i13 + 2)
                                u17 = M[idx]
                            i9 = i13
                            if (u17 >> 6) & 1:
                                break
                            idx += 1
                            f = M[idx]
                            i13 = i12
                            i12 += 1
                            if f == 0:
                                break
                    break
                if (f >> 7) & 1:
                    cnt = 2 if (f & 7) == 0 else (f & 7)
                    if cnt > 1 and o() < CAP:
                        u = cnt
                        while True:
                            emit(i8 + 1, sv)
                            if u < 3:
                                break
                            u -= 1
                            if not (o() - 2 < 0x5e):
                                break
                    break
                i8 += 1
                f = M[i8]
                i9 = i8
                if f == 0:
                    break
            state = 'L8BC'
            continue
        if state == 'L8BC':
            if M[i9] == 0:
                state = 'FIN'
                continue
            i9 += 1
            f = M[i9]
            i8 = i9
            if f == 0:
                state = 'FIN'
                continue
            state = 'TOP'
            continue
        if state == 'FIN':
            e = i9
            if e >= n:
                e = n - 1
            out.append(e + 1)
            if len(out) - 1 + 2 < 3:  # o==0 never happens
                return []
            return [(out[2 * m], out[2 * m + 1]) for m in range(len(out) // 2)]
