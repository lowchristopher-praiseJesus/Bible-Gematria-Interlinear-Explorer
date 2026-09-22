# Character profiles

One profile for each of the 50 characters in `bible_index.db`: who they are, what the verses linked to them say, how they relate to other people (including people outside the 50), and where the classification is weak.

## How these were made

- **Verses.** Every verse the fan-out classification links to the character at probability ≥ 0.50 (King James text). For each character the profile draws on those verses, reading neighbouring verses where a verse alone (a pronoun, "the woman", "his mother") does not make the scene clear. Quotations are from the KJV text in the database.
- **Family and relationships.** From STEPBible's TIPNR (the same file `validate` downloads): parents, siblings, partners and children, with people outside the 50 named in the tables and text. TIPNR's own one-line "who they are" appears in each header.
- **Reliability.** Each profile ends with **Reading the data**: verses the classifier got wrong (for example 2 Kings 11:16 under Jezebel, John 9:23 under Joseph, Nehemiah 7:7), links that depend on a tradition rather than the text (the Psalms for David, Ecclesiastes for Solomon, the letters and Revelation for John), and named verses it missed. Overall precision is roughly 90%, so treat weak links (0.50–0.70) as *likely*, not certain.
- **Numbers.** "Verses linked" counts verses at ≥ 0.50; "shared verses" means verses linked to both characters.

## Old Testament (39)

| Character | Verses linked | Summary |
|---|---|---|
| [Adam](adam.md) | 53 | The first man: formed from the ground, placed in Eden, disobeyed, was driven out, and became the father of the human race. |
| [Eve](eve.md) | 29 | The first woman: formed from Adam's rib, deceived by the serpent, and named "the mother of all living". |
| [Cain](cain.md) | 18 | The firstborn son of Adam and Eve, a farmer, and the Bible's first murderer, who killed his brother Abel. |
| [Abel](abel.md) | 8 | The second son of Adam and Eve, a shepherd whose offering God accepted and whom his brother Cain murdered. |
| [Noah](noah.md) | 75 | The righteous man God chose to build the ark and survive the Flood, and the man with whom God made the first covenant after it. |
| [Abraham](abraham.md) | 351 | The patriarch God called out of Ur, to whom he promised land, a great nation and a blessing for all peoples; the father of Isaac and "father of all them that believe". |
| [Sarah](sarah.md) | 72 | Abraham's wife (first Sarai), the mother of Isaac at ninety, and the "freewoman" of Paul's allegory. |
| [Lot](lot.md) | 53 | Abraham's nephew, who chose the well-watered plain of Sodom, was rescued from its destruction, and became the ancestor of Moab and Ammon. |
| [Isaac](isaac.md) | 156 | The son of promise born to Abraham and Sarah in their old age, offered on Moriah, husband of Rebekah and father of Esau and Jacob. |
| [Jacob (Israel)](jacob.md) | 593 | Isaac's younger twin, who took Esau's birthright and blessing, wrestled with God and was renamed Israel; father of the twelve sons from whom the tribes descend, and the name the whole nation later carries. |
| [Joseph](joseph.md) | 345 | Jacob's favoured son, sold into slavery by his brothers, who rose from prison to rule Egypt and saved his family in the famine; his sons Ephraim and Manasseh became tribes named for him. |
| [Moses](moses.md) | 1,384 | The Levite raised in Pharaoh's house whom God sent to bring Israel out of Egypt, give them the law at Sinai and lead them to the edge of the promised land. |
| [Aaron](aaron.md) | 447 | Moses' older brother and spokesman, consecrated as Israel's first high priest, whose descendants held the priesthood. |
| [Miriam](miriam.md) | 20 | Moses' and Aaron's sister, the prophetess who watched over the baby Moses, led the women's song at the Red Sea, and was struck with leprosy for challenging Moses. |
| [Joshua](joshua.md) | 309 | Moses' assistant and successor, the Ephraimite spy who trusted God, and the man who led Israel over the Jordan and into the conquest and division of Canaan. |
| [Rahab](rahab.md) | 27 | The Canaanite woman of Jericho who hid Israel's spies, confessed the LORD as God, and was spared; remembered in the New Testament for faith and named in Jesus' ancestry. |
| [Gideon](gideon.md) | 92 | The fearful "least in my father's house" called by an angel to defeat Midian with 300 men, who refused the crown and then made an ephod that became a snare. |
| [Samson](samson.md) | 76 | The Nazirite judge of Dan, born to a barren mother, whose God-given strength against the Philistines was undone by Delilah and restored in his death. |
| [Delilah](delilah.md) | 17 | The woman of the Valley of Sorek whom Samson loved, whom the Philistine lords paid to find the secret of his strength; her only appearance is Judges 16:4–20. |
| [Ruth](ruth.md) | 63 | The Moabite widow who stayed with her mother-in-law Naomi, married Boaz, and became the great-grandmother of King David and an ancestor of Jesus. |
| [Samuel](samuel.md) | 175 | The prophet, priest-in-training and last judge, dedicated to God by his mother Hannah, who anointed both Saul and David as Israel's first kings. |
| [King Saul](saul.md) | 441 | The first king of Israel: a Benjamite chosen for his height and modesty who was rejected for disobedience, hunted David out of jealousy, and died at Gilboa. |
| [David](david.md) | 1,857 | The shepherd boy from Bethlehem anointed by Samuel, who killed Goliath, fled Saul, became king of Judah and then all Israel, took Jerusalem, sinned with Bathsheba, and was promised an everlasting house; the ancestor the Messiah is "son of". |
| [Goliath](goliath.md) | 31 | The Philistine champion of Gath, six cubits and a span tall, who defied Israel's army for forty days until David killed him with a sling and stone. |
| [Jonathan](jonathan.md) | 110 | King Saul's eldest son and heir, a brave warrior and David's closest friend, who gave up his claim to the throne and died with his father at Gilboa. |
| [Bathsheba](bathsheba.md) | 41 | The wife of Uriah the Hittite whom David took, who became David's wife and the mother of Solomon, and who then pressed the claim of her son to the throne. |
| [Solomon](solomon.md) | 669 | David's son by Bathsheba and third king of Israel: asked God for wisdom, built the temple, gathered great wealth, then turned to other gods through his foreign wives; traditional author of Proverbs, Ecclesiastes and the Song of Songs. |
| [Elijah](elijah.md) | 156 | The Tishbite prophet who stood against King Ahab and the prophets of Baal, was fed by ravens, called down fire at Mount Carmel, heard God in a still small voice, and was taken to heaven in a whirlwind. |
| [Elisha](elisha.md) | 143 | Elijah's successor: the farmer called by a cloak, who asked for a double portion of Elijah's spirit and worked miracles of provision, healing and resurrection over about fifty years of Israel's kings. |
| [Jezebel](jezebel.md) | 31 | The Phoenician princess who married King Ahab, promoted Baal worship, killed the LORD's prophets, arranged Naboth's death, and was thrown from a window at Jehu's command; her name later became a byword for a false teacher. |
| [Isaiah](isaiah.md) | 108 | The prophet of Jerusalem under Uzziah, Jotham, Ahaz and Hezekiah, who saw the LORD in the temple, counselled kings through the Assyrian crisis, and is quoted in the New Testament more than any other prophet. |
| [Jeremiah](jeremiah.md) | 434 | The priest's son from Anathoth called as a young man to be a prophet to the nations, who warned Judah for over forty years of Babylon's coming, was beaten, jailed and thrown into a cistern, and lived to see Jerusalem fall. |
| [Jonah](jonah.md) | 42 | The reluctant prophet from Gath-hepher who fled from God's command to preach to Nineveh, spent three days in a great fish, preached, and then resented God's mercy on the city; Jesus' "sign of Jonas". |
| [Daniel](daniel.md) | 146 | The Judean nobleman taken to Babylon as a youth, called Belteshazzar, who interpreted dreams for Nebuchadnezzar and Belshazzar, survived the lions' den under Darius, and received visions of the kingdoms to come. |
| [Nebuchadnezzar](nebuchadnezzar.md) | 302 | The king of Babylon who besieged and destroyed Jerusalem and took Judah into exile; in the book of Daniel, the proud emperor who dreamed of a great image, built a golden statue, and was humbled until he praised the God of heaven. |
| [Esther](esther.md) | 57 | The Jewish orphan Hadassah, raised by her cousin Mordecai, who became queen of Persia and risked her life to stop Haman's plan to destroy her people; the reason for the feast of Purim. |
| [Mordecai](mordecai.md) | 57 | The Jew at the king's gate in Shushan who raised his cousin Esther, refused to bow to Haman, exposed a plot on the king, and rose to be second only to King Ahasuerus. |
| [Job](job.md) | 607 | The blameless man of Uz who lost his children, wealth and health, argued with three friends and with God, was answered out of the whirlwind, and was restored; the Bible's model of endurance and honest complaint. |
| [Nehemiah](nehemiah.md) | 118 | The cupbearer of the Persian king Artaxerxes who returned to Jerusalem as governor, rebuilt its wall in 52 days against opposition, and pressed for reform in the community. |

## New Testament (11)

| Character | Verses linked | Summary |
|---|---|---|
| [Jesus](jesus.md) | 4,042 | Jesus of Nazareth, called the Christ: born of Mary, baptized by John, who taught, healed and called disciples in Galilee and Judaea, was crucified under Pontius Pilate, rose on the third day, and is presented in the rest of the New Testament as Lord, Saviour and coming King. |
| [Mary (Mother of Jesus)](mary_mother.md) | 80 | The young woman of Nazareth, betrothed to Joseph, who conceived by the Holy Spirit and bore Jesus; present at his birth, at Cana and at the cross, and among the disciples in Jerusalem after the resurrection. |
| [Joseph (Husband of Mary)](joseph_husband.md) | 34 | The carpenter of Nazareth of David's line, betrothed to Mary, who took her and the child into his home on an angel's word and protected them through the flight to Egypt and the return to Nazareth. |
| [John the Baptist](john_baptist.md) | 158 | The prophet in camel's hair who preached repentance in the Jordan wilderness, baptized Jesus, pointed to him as the Lamb of God, and was imprisoned and beheaded by Herod Antipas. |
| [Peter (Simon Peter)](peter.md) | 438 | The Galilean fisherman Simon whom Jesus named Peter ("rock"): the first to confess him as the Christ, the disciple who denied him three times, and the leading voice of the apostles in Acts. |
| [John (Apostle)](john_apostle.md) | 300 | The fisherman son of Zebedee whom Jesus called with his brother James, one of the inner three; in tradition the "disciple whom Jesus loved", and the author of the Fourth Gospel, three letters and Revelation. |
| [Judas Iscariot](judas_iscariot.md) | 102 | One of the twelve apostles and their treasurer, who agreed with the chief priests to deliver Jesus for thirty pieces of silver, identified him with a kiss in Gethsemane, and died by his own hand. |
| [Thomas](thomas.md) | 21 | One of the twelve apostles, also called Didymus ("the Twin"), who offered to die with Jesus, asked "how can we know the way?", and refused to believe the resurrection until he saw the wounds. |
| [Mary Magdalene](mary_magdalene.md) | 57 | The woman from Magdala, healed of seven demons, who followed Jesus, stood at the cross, watched his burial, and was the first to see him alive. |
| [Pontius Pilate](pontius_pilate.md) | 85 | The Roman governor of Judaea who examined Jesus, three times declared him innocent, and then gave the order for his crucifixion; the man named in the creeds for it. |
| [Lazarus](lazarus.md) | 26 | The man of Bethany, brother of Martha and Mary, whom Jesus loved and raised from the dead after four days; the sign that led the chief priests to plan his own death too. |

---
*Verse data: `bible_index.db` (JEV fan-out classification). Family data: TIPNR, STEPBible.org / Tyndale House Cambridge, CC BY 4.0, https://github.com/STEPBible/STEPBible-Data. Profiles were written on 2026-09-20 from that data; changing the database or thresholds will change the counts, not these narratives.*
