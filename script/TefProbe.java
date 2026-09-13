// Diagnostic wrapper around unmodified TuxGuitar 2.1.0 libraries.
// Run in an isolated Java process. Outputs are private test artifacts, not fixtures.
import java.io.*;
import app.tuxguitar.io.base.*;
import app.tuxguitar.song.factory.TGFactory;
import app.tuxguitar.song.models.*;

class TefProbe {
  public static void main(String[] args) throws Exception {
    TGFactory factory = new TGFactory();
    var annotations = new java.util.HashMap<Integer, Integer>();
    byte[] normalized = normalizeAnnotations(java.nio.file.Files.readAllBytes(java.nio.file.Path.of(args[0])), annotations);
    var raw = new app.tuxguitar.io.tef2.TEInputStream(new ByteArrayInputStream(normalized)).readSong();
    if (raw.getTracks().length != 1 || raw.getTracks()[0].getStrings().length != 5 || raw.getTracks()[0].isPercussion() || raw.getTracks()[0].getCapo() != 0 || raw.getRepeats().length != 0) {
      throw new IllegalArgumentException("Preview requires one five-string track without capo or repeat maps");
    }
    for (int i = 0; i < raw.getMeasures(); i++) {
      if (raw.getTimeSignature(i).getNumerator() != 4 || raw.getTimeSignature(i).getDenominator() != 4) throw new IllegalArgumentException("Preview requires 4/4 throughout");
    }
    var annotationNotes = new java.util.IdentityHashMap<app.tuxguitar.io.tef2.base.TEComponentNote, Integer>();
    int noteIndex = 0;
    for (var component : raw.getComponents()) if (component instanceof app.tuxguitar.io.tef2.base.TEComponentNote n) {
      if (annotations.containsKey(noteIndex)) annotationNotes.put(n, annotations.get(noteIndex));
      noteIndex++;
    }
    var effects = new java.util.TreeMap<String, Integer>();
    for (var component : raw.getComponents()) if (component instanceof app.tuxguitar.io.tef2.base.TEComponentNote n) {
      effects.merge(n.getEffect1() + "/" + n.getEffect2(), 1, Integer::sum);
    }
    System.out.println("raw effects=" + effects + " repeats=" + java.util.Arrays.toString(raw.getRepeats()));
    TGSongReaderHandle input = new TGSongReaderHandle();
    input.setFactory(factory);
    input.setContext(new TGSongStreamContext());
    input.setInputStream(new ByteArrayInputStream(normalized));
    new app.tuxguitar.io.tef2.TESongReader().read(input);
    TGSong song = input.getSong();
    // TEF2 effect1=2 is omitted by TuxGuitar. Its shared hammer flag also
    // represents pull-offs. Match raw coordinates, never infer from fret changes.
    for (var component : raw.getComponents()) if (component instanceof app.tuxguitar.io.tef2.base.TEComponentNote n && n.getEffect1() == 2) {
      int offset = 0;
      int matches = 0;
      for (int t = 0; t < song.countTracks(); t++) {
        TGTrack track = song.getTrack(t);
        int string = n.getString() - offset + 1;
        offset += track.getStrings().size();
        if (string < 1 || string > track.getStrings().size()) continue;
        TGMeasure measure = track.getMeasure(n.getMeasure());
        if (n.getDuration() % 3 == 2) throw new IllegalArgumentException("Tuplet pull-off mapping not supported by this probe");
        long tick = measure.getStart() + n.getPosition() * TGDuration.QUARTER_TIME / 64;
        for (TGBeat beat : measure.getBeats()) if (beat.getStart() == tick) {
          for (int v = 0; v < beat.countVoices(); v++) for (TGNote note : beat.getVoice(v).getNotes()) {
            if (note.getString() == string && note.getValue() == n.getFret()) {
              note.getEffect().setHammer(true);
              matches++;
            }
          }
        }
      }
      if (matches != 1) throw new IllegalArgumentException("Ambiguous TEF pull-off mapping: " + matches);
    }
    // Populate precision metadata without reflowing notes or removing leading silence.
    song.getTracks().forEachRemaining(t -> t.getMeasures().forEachRemaining(m -> {
      for (TGBeat beat : m.getBeats()) beat.setPreciseStart(TGDuration.toPreciseTime(beat.getStart()));
      new app.tuxguitar.song.managers.TGSongManager().getMeasureManager().autoCompleteSilences(m);
      m.getBeats().sort(java.util.Comparator.comparingLong(TGBeat::getStart));
    }));
    System.out.println("TEF v2 reader succeeded; measures=" + song.countMeasureHeaders() + "; tracks=" + song.countTracks());
    song.getMeasureHeaders().forEachRemaining(h -> System.out.println("bar=" + h.getNumber() + " tempo=" + h.getTempo().getQuarterValue() + " meter=" + h.getTimeSignature().getNumerator() + "/" + h.getTimeSignature().getDenominator().getValue()));
    song.getTracks().forEachRemaining(track -> {
      System.out.println("track=" + track.getName());
      track.getStrings().forEach(s -> System.out.println("string=" + s.getNumber() + " pitch=" + s.getValue()));
      track.getMeasures().forEachRemaining(m -> {
        for (TGBeat beat : m.getBeats()) for (int v=0; v<beat.countVoices(); v++) {
          TGVoice voice = beat.getVoice(v);
          for (TGNote note : voice.getNotes()) System.out.println("note bar=" + m.getNumber() + " tick=" + beat.getStart() + " voice=" + v + " duration=" + voice.getDuration().getTime() + " string=" + note.getString() + " fret=" + note.getValue());
        }
      });
    });
    TGSongWriterHandle output = new TGSongWriterHandle();
    output.setFactory(factory);
    output.setContext(new TGSongStreamContext());
    output.setSong(song);
    try (OutputStream stream = new FileOutputStream(args[1])) {
      output.setOutputStream(stream);
      new app.tuxguitar.io.musicxml.MusicXMLSongWriter().write(output);
    }
    labelPullOffs(args[1], annotationNotes);
  }

  // TEF2's fixed component block is also used by the upstream TEInputStream.
  // Bit 0x20 marks an annotation payload, NOT an extended fret or effect2.
  // Never mutate the original file. Keep annotation codes separate, including
  // unknown codes; their meaning must not be guessed from pitch or location.
  static byte[] normalizeAnnotations(byte[] source, java.util.Map<Integer, Integer> annotations) {
    if (source.length < 258) throw new IllegalArgumentException("Truncated TEF2 header");
    byte[] result = source.clone();
    int count = (source[256] & 255) | ((source[257] & 255) << 8);
    if (258L + count * 6L > source.length) throw new IllegalArgumentException("Truncated TEF2 components");
    int note = 0;
    for (int i = 0; i < count; i++) {
      int offset = 258 + i * 6;
      int fretCode = source[offset + 2] & 31;
      if (fretCode < 1 || fretCode > 25) continue;
      if ((source[offset + 2] & 32) != 0) {
        annotations.put(note, source[offset + 5] & 255);
        result[offset + 2] &= ~32;
        result[offset + 5] = 0;
      }
      note++;
    }
    return result;
  }

  // TuxGuitar writes both techniques as hammer-on. Correct each explicit pair,
  // including the duplicate standard staff; reject overlapping ambiguous spans.
  static void labelPullOffs(String path, java.util.Map<app.tuxguitar.io.tef2.base.TEComponentNote, Integer> annotations) throws Exception {
    var factory = javax.xml.parsers.DocumentBuilderFactory.newInstance();
    factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
    factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
    var doc = factory.newDocumentBuilder().parse(new File(path));
    if (!annotations.isEmpty() && doc.getElementsByTagName("part").getLength() != 1) throw new IllegalArgumentException("Annotated TEF preview currently requires one part");
    for (var entry : annotations.entrySet()) {
      var source = entry.getKey();
      var measure = (org.w3c.dom.Element) doc.getElementsByTagName("measure").item(source.getMeasure());
      // Match the tab note by voice-order onset and explicit string/fret; then
      // attach annotations without modifying pitches or standard-staff music.
      long tick = 0, previous = 0;
      int matches = 0;
      for (var item = measure.getFirstChild(); item != null; item = item.getNextSibling()) {
        if (!(item instanceof org.w3c.dom.Element e)) continue;
        if (e.getTagName().equals("backup")) tick -= Long.parseLong(value(e, "duration"));
        if (!e.getTagName().equals("note")) continue;
        boolean chord = e.getElementsByTagName("chord").getLength() > 0;
        long onset = chord ? previous : tick;
        if (!chord) { previous = onset; tick += Long.parseLong(value(e, "duration")); }
        if (onset != source.getPosition() * 15L || !value(e, "string").equals(Integer.toString(source.getString() + 1)) || !value(e, "fret").equals(Integer.toString(source.getFret()))) continue;
        var technical = (org.w3c.dom.Element) e.getElementsByTagName("technical").item(0);
        var annotation = doc.createElement(entry.getValue() == 4 ? "fingering" : "other-technical");
        if (entry.getValue() == 4) { annotation.setAttribute("enclosure", "circle"); annotation.setTextContent("3"); }
        else annotation.setTextContent("Unresolved TEF fingering annotation code " + entry.getValue());
        technical.appendChild(annotation);
        matches++;
      }
      if (matches != 1) throw new IllegalArgumentException("Cannot preserve TEF annotation at measure " + (source.getMeasure() + 1));
      System.out.println("annotation bar=" + (source.getMeasure() + 1) + " string=" + (source.getString() + 1) + " position=" + source.getPosition() + " fret=" + source.getFret() + " code=" + entry.getValue());
    }
    var pending = new java.util.HashMap<String, org.w3c.dom.Element>();
    var pitches = new java.util.HashMap<String, Integer>();
    var notes = doc.getElementsByTagName("note");
    for (int i = 0; i < notes.getLength(); i++) {
      var note = (org.w3c.dom.Element) notes.item(i);
      var markers = note.getElementsByTagName("hammer-on");
      var copy = new java.util.ArrayList<org.w3c.dom.Element>();
      for (int j = 0; j < markers.getLength(); j++) copy.add((org.w3c.dom.Element) markers.item(j));
      if (copy.isEmpty()) continue;
      String key = note.getParentNode().getParentNode().getAttributes().getNamedItem("id").getNodeValue() + ":" + value(note, "staff") + ":" + value(note, "voice");
      int pitch = "C D EF G A B".indexOf(value(note, "step")) + 12 * Integer.parseInt(value(note, "octave"));
      if (!value(note, "alter").isEmpty()) pitch += Integer.parseInt(value(note, "alter"));
      for (var marker : copy) {
        if (marker.getAttribute("type").equals("start")) {
          if (pending.putIfAbsent(key, marker) != null) throw new IllegalArgumentException("Overlapping technique spans not supported by probe");
          pitches.put(key, pitch);
        } else {
          var start = pending.remove(key);
          if (start == null) throw new IllegalArgumentException("Unpaired technique stop");
          if (pitch < pitches.remove(key)) {
            doc.renameNode(start, null, "pull-off");
            start.setTextContent("PO");
            doc.renameNode(marker, null, "pull-off");
          }
        }
      }
    }
    if (!pending.isEmpty()) throw new IllegalArgumentException("Unpaired technique start");
    var transformer = javax.xml.transform.TransformerFactory.newInstance().newTransformer();
    transformer.transform(new javax.xml.transform.dom.DOMSource(doc), new javax.xml.transform.stream.StreamResult(new File(path)));
  }

  static String value(org.w3c.dom.Element element, String name) {
    var nodes = element.getElementsByTagName(name);
    return nodes.getLength() == 0 ? "" : nodes.item(0).getTextContent();
  }
}
