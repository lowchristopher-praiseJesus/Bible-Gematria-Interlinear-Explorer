# chatbot/data/passage_eval.py
"""Labelled queries for scripts/eval_passages.py (live, manual).

`must_see` lists KJV verses a reasonable reader expects among a query's top
10 results; a hit is any returned passage whose verse span contains one of
them. These labels are subjective for contested topics — the point is a
stable yardstick for tuning thresholds, not a verdict on doctrine. Every
reference is verified against Complete.db by
tests/chatbot/test_passage_eval_data.py."""

CONCEPT = [
    {"query": "Where is the rapture talked about in the Bible?", "must_see": ["1 Thessalonians 4:17", "1 Corinthians 15:52", "John 14:3"]},
    {"query": "What does the Bible say about speaking in tongues?", "must_see": ["1 Corinthians 14:2", "Acts 2:4", "1 Corinthians 12:10"]},
    {"query": "Who is the antichrist?", "must_see": ["1 John 2:18", "2 Thessalonians 2:3", "1 John 4:3"]},
    {"query": "Where does the Bible talk about the new birth?", "must_see": ["John 3:3", "1 Peter 1:23", "Titus 3:5"]},
    {"query": "What does the Bible say about forgiving others?", "must_see": ["Matthew 6:14", "Colossians 3:13", "Matthew 18:21"]},
    {"query": "Where is the Trinity taught?", "must_see": ["Matthew 28:19", "2 Corinthians 13:14", "1 John 5:7"]},
    {"query": "What does the Bible say about tithing?", "must_see": ["Malachi 3:10", "Genesis 14:20", "Leviticus 27:30"]},
    {"query": "Passages about the second coming of Christ", "must_see": ["Acts 1:11", "Matthew 24:30", "Revelation 1:7"]},
    {"query": "Where does it talk about the resurrection of the dead?", "must_see": ["1 Corinthians 15:20", "John 11:25", "Daniel 12:2"]},
    {"query": "What does the Bible say about divorce?", "must_see": ["Matthew 19:9", "Malachi 2:16", "1 Corinthians 7:15"]},
    {"query": "Verses about anxiety and worry", "must_see": ["Philippians 4:6", "Matthew 6:25", "1 Peter 5:7"]},
    {"query": "What does the Bible say about the Sabbath?", "must_see": ["Exodus 20:8", "Mark 2:27", "Colossians 2:16"]},
    {"query": "Where is baptism explained?", "must_see": ["Romans 6:4", "Matthew 28:19", "Acts 2:38"]},
    {"query": "What does the Bible say about the end times tribulation?", "must_see": ["Matthew 24:21", "Daniel 12:1", "Revelation 7:14"]},
    {"query": "Where does the Bible describe heaven?", "must_see": ["Revelation 21:4", "John 14:2", "2 Corinthians 5:1"]},
    {"query": "What does the Bible say about hell?", "must_see": ["Mark 9:44", "Revelation 20:15", "Matthew 25:41"]},
    {"query": "How is a person saved?", "must_see": ["Ephesians 2:8", "Romans 10:9", "Acts 16:31"]},
    {"query": "What does the Bible say about the Holy Spirit as a guide?", "must_see": ["John 16:13", "Romans 8:14", "John 14:26"]},
    {"query": "Verses about the armor of God", "must_see": ["Ephesians 6:11", "Ephesians 6:14", "1 Thessalonians 5:8"]},
    {"query": "What does the Bible say about giving to the poor?", "must_see": ["Proverbs 19:17", "Matthew 25:40", "Deuteronomy 15:11"]},
    {"query": "Where does the Bible talk about fasting?", "must_see": ["Matthew 6:16", "Isaiah 58:6", "Joel 2:12"]},
    {"query": "What does the Bible say about the tongue and speech?", "must_see": ["James 3:5", "Proverbs 18:21", "Ephesians 4:29"]},
    {"query": "Passages about angels", "must_see": ["Hebrews 1:14", "Psalm 91:11", "Luke 1:26"]},
    {"query": "What does the Bible say about the last judgment?", "must_see": ["Revelation 20:12", "2 Corinthians 5:10", "Matthew 25:32"]},
    {"query": "Where is the millennial reign of Christ described?", "must_see": ["Revelation 20:4", "Isaiah 11:6", "Zechariah 14:9"]},
    {"query": "What does the Bible say about false prophets?", "must_see": ["Matthew 7:15", "Deuteronomy 13:1", "2 Peter 2:1"]},
    {"query": "Where does the Bible talk about the fear of the Lord?", "must_see": ["Proverbs 9:10", "Ecclesiastes 12:13", "Psalm 111:10"]},
    {"query": "What does the Bible say about marriage?", "must_see": ["Genesis 2:24", "Ephesians 5:25", "Hebrews 13:4"]},
    {"query": "Passages about the covenant with Abraham", "must_see": ["Genesis 12:2", "Genesis 15:18", "Genesis 17:7"]},
    {"query": "What does the Bible say about the Lord's Supper?", "must_see": ["1 Corinthians 11:24", "Matthew 26:26", "Luke 22:19"]},
]

PASSAGE = [
    {"query": "Romans 8:28", "must_see": ["Genesis 50:20", "Jeremiah 29:11", "Ephesians 1:11"]},
    {"query": "John 3:16", "must_see": ["Romans 5:8", "1 John 4:9", "Ephesians 2:4"]},
    {"query": "Psalm 23:1", "must_see": ["John 10:11", "Isaiah 40:11", "Ezekiel 34:11"]},
    {"query": "Isaiah 53:5", "must_see": ["1 Peter 2:24", "Romans 4:25", "Matthew 8:17"]},
    {"query": "Genesis 1:1", "must_see": ["John 1:1", "Hebrews 11:3", "Colossians 1:16"]},
    {"query": "Philippians 4:13", "must_see": ["2 Corinthians 12:9", "John 15:5", "Ephesians 3:16"]},
]

OFF_TOPIC = [
    "best pizza recipe",
    "how do I change a car tire",
    "who won the 2018 world cup",
    "python list comprehension syntax",
    "what is the capital of Australia",
    "how to lower my mortgage interest rate",
]
