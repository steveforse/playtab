import java.util.*;

// Original synthetic records, no private arrangement required.
class TefAnnotationTest {
  public static void main(String[] args) {
    byte[] source = new byte[258 + 4 * 6];
    source[256] = 4;
    int[] frets = {0, 5, 7, 9};
    int[] codes = {2, 4, 6, 4};
    for (int i = 0; i < 4; i++) {
      int p = 258 + i * 6;
      source[p + 2] = (byte)(frets[i] + 1 | (i < 3 ? 32 : 0));
      source[p + 4] = 1; // independent hammer-on effect must survive
      source[p + 5] = (byte)codes[i];
    }
    byte[] before = source.clone();
    var annotations = new HashMap<Integer, Integer>();
    byte[] clean = TefProbe.normalizeAnnotations(source, annotations);
    if (!Arrays.equals(source, before)) throw new AssertionError("Original input mutated");
    if (!annotations.equals(Map.of(0, 2, 1, 4, 2, 6))) throw new AssertionError("Annotation loss");
    for (int i = 0; i < 4; i++) {
      int p = 258 + i * 6;
      if (clean[p + 2] != frets[i] + 1 || clean[p + 4] != 1) throw new AssertionError("Note or independent effect changed");
      if (clean[p + 5] != (i < 3 ? 0 : 4)) throw new AssertionError("Unflagged effects must be retained");
    }
    try { TefProbe.normalizeAnnotations(new byte[12], new HashMap<>()); throw new AssertionError("Truncation accepted"); }
    catch (IllegalArgumentException expected) { }
    System.out.println("TEF annotation normalization checks passed");
  }
}
