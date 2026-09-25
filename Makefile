# X11 build (RVIP): port/bcrt.pas replaces FPC's crt, port/be_x11.c draws it.
X11 = /opt/X11
boss: boss.pas inc/*.inc port/bcrt.pas port/be.o
	fpc boss.pas -O3 -gl -Fuport -Foport -Flport -Fl$(X11)/lib -k-L$(X11)/lib

port/be.o: port/be_x11.c
	cc -c -O2 -I$(X11)/include -I$(X11)/include/freetype2 -o $@ $<

# wizard mode from the start, for testing only
test: port/be.o
	fpc boss.pas -O1 -gl -dRLTEST -Fuport -Foport -Flport -Fl$(X11)/lib -k-L$(X11)/lib -oboss-test

clean:
	rm -f boss boss-test boss.o port/*.o port/*.ppu

# RVIP step 1 check run: range/overflow/IO checks + heap trace (no ASan for Pascal)
check: port/be.o
	fpc boss.pas -O1 -gl -gh -Cr -Co -Ci -Ct -dRLTEST -Fuport -Foport -Flport -Fl$(X11)/lib -k-L$(X11)/lib -oboss-check
